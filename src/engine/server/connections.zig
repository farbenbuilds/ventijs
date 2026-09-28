//! Engine WebSocket route wiring: comptime trampolines and connection events. Each
//! server slot gets its own callback set, so the engine ABI needs no user context, and
//! no code other than these handlers runs on an engine thread. Outbound messages leave
//! through the cluster inbox: the Node main thread pushes a staged payload with `pump`,
//! and the engine routes it to the socket subscribed to that connection's topic. Only
//! text and binary travel that way, because the topic publisher maps a message to those.

const uwz = @import("uWebZockets");
const inbound = @import("inbound.zig");
const instance = @import("instance.zig");
const queues = @import("../socket/queues.zig");
const topic = @import("topic.zig");

/// Registers the WebSocket route on the worker with the trusted limits.
pub fn attach_route(target: *instance.Instance) !void {
    const app = target.cluster.worker(0) orelse return error.EngineWorkerMissing;
    const compression: uwz.WsCompression = if (target.config.limits.permessage_deflate)
        .permessage_deflate
    else
        .disabled;
    switch (target.handle.slot) {
        inline 0...instance.server_capacity - 1 => |slot| {
            const Trampoline = trampolines(slot);
            _ = try app.ws(target.config.path_slice(), .{
                .open = Trampoline.open,
                .message = Trampoline.message,
                .close = Trampoline.close,
                .compression = compression,
                .max_frame_size = target.config.limits.max_frame_bytes,
                .max_message_size = target.config.limits.max_message_bytes,
            });
        },
        else => return error.ServerCapacityExhausted,
    }
}

fn trampolines(comptime slot: usize) type {
    return struct {
        fn open(ws: *uwz.WebSocket) void {
            on_open(slot, ws);
        }

        fn message(ws: *uwz.WebSocket, bytes: []const u8, opcode: uwz.Opcode) void {
            inbound.on_message(slot, ws, bytes, opcode);
        }

        fn close(ws: *uwz.WebSocket) void {
            on_close(slot, ws);
        }
    };
}

fn on_open(slot: usize, ws: *uwz.WebSocket) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    if (server.slab.count_active() >= server.config.limits.max_connections) {
        ws.terminate();
        return;
    }
    // Every other refusal path here terminates the connection, and this one has
    // to as well: returning leaves the engine connection upgraded and tracked by
    // nobody, so it can never produce a `connection_close` and the engine holds
    // it until the peer gives up.
    const index = instance.connection_index(server, ws) orelse {
        ws.terminate();
        return;
    };
    // The slab slot is already active, so the engine connection is a
    // duplicate. Terminate the refused connection instead of leaking it.
    const handle = server.slab.acquire(index) catch {
        ws.terminate();
        return;
    };
    server.sockets.open(index, handle.generation);
    // A connection that could not subscribe has no outbound path, so it is
    // terminated rather than announced. Announcing it would hand JavaScript a
    // live socket whose every `send` is silently discarded.
    switch (topic.subscribe(server, ws, index, handle.generation)) {
        .ok => {},
        .capacity_reached, .no_worker => {
            _ = server.sockets.finish(index);
            _ = server.slab.release(index);
            ws.terminate();
            return;
        },
    }
    _ = server.channel.emit(.{
        .kind = .connection_open,
        .server = server.handle.to_int(),
        .index = handle.index,
        .generation = handle.generation,
    });
}

fn on_close(slot: usize, ws: *uwz.WebSocket) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    const app = server.cluster.worker(0) orelse return;
    app.pubsub.unsubscribe_all(ws);
    const index = instance.connection_index(server, ws) orelse return;
    if (!server.sockets.finish(index)) return;
    const handle = server.slab.release(index) orelse return;
    _ = server.channel.emit_terminal(.{
        .kind = .connection_close,
        .server = server.handle.to_int(),
        .index = handle.index,
        .generation = handle.generation,
    });
}
