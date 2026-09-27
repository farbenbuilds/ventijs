//! Engine WebSocket route wiring: comptime trampolines and connection events.
//!
//! Each server slot gets its own tiny callback set, so the engine ABI needs no
//! user context. Handlers resolve the server through the instance table, map
//! the engine connection to a slab slot, and emit through the callback
//! channel. No other code runs on an engine thread.
//!
//! Outbound messages leave the engine through the cluster inbox. The Node main
//! thread pushes a staged payload with `pump`, which wakes this engine thread;
//! the engine then routes it to the socket subscribed to that connection's
//! topic. Only text and binary can travel that way, because the topic
//! publisher maps a message onto a text or binary opcode and nothing else.

const uwz = @import("uWebZockets");
const instance = @import("instance.zig");
const payload = @import("../socket/payload.zig");
const queues = @import("../socket/queues.zig");
const topic = @import("topic.zig");

/// Registers the WebSocket route on the worker with the trusted limits.
pub fn attach_route(target: *instance.Instance) !void {
    const app = target.cluster.worker(0) orelse return error.EngineWorkerMissing;
    switch (target.handle.slot) {
        inline 0...instance.server_capacity - 1 => |slot| {
            const Trampoline = trampolines(slot);
            _ = try app.ws(target.config.path_slice(), .{
                .open = Trampoline.open,
                .message = Trampoline.message,
                .close = Trampoline.close,
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
            on_message(slot, ws, bytes, opcode);
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
    const index = connection_index(server, ws) orelse return;
    // The slab slot is already active, so the engine connection is a
    // duplicate. Terminate the refused connection instead of leaking it.
    const handle = server.slab.acquire(index) catch {
        ws.terminate();
        return;
    };
    server.sockets.open(index, handle.generation);
    topic.subscribe(server, ws, index, handle.generation);
    _ = server.channel.emit(.{
        .kind = .connection_open,
        .server = server.handle.to_int(),
        .index = handle.index,
        .generation = handle.generation,
    });
}

/// Copies one parsed message into the server's inbound ring and wakes the Node
/// main thread. The bytes only borrow the engine's own message buffer for the
/// duration of this call, so the copy is what makes the payload survive past the
/// callback.
///
/// A paused connection drops here, which is a real divergence from `ws` and is
/// recorded rather than papered over. `ws.pause()` pauses the underlying socket,
/// so the bytes stay in the kernel receive buffer and the engine never reads
/// them. The pinned engine has no per-connection read pause, and the two
/// alternatives were both worse: withholding only the wakeup leaves the payload
/// in a ring shared by every connection, so one paused peer that keeps sending
/// fills a ring of 64 slots and every other connection on the server starts
/// losing messages, and per-connection inbound rings are not implemented. A drop
/// is bounded to the connection that asked to be paused.
///
/// The drop is counted. An earlier version returned before staging without
/// touching the counter, so `serverDroppedMessages` reported zero while data was
/// being lost, which is the worst of both: unbounded and invisible.
///
/// A ring that refused the message produces no event either. Announcing one that
/// was never staged leaves JavaScript waiting for bytes that do not exist, and
/// the drop counter is the only honest evidence.
fn on_message(slot: usize, ws: *uwz.WebSocket, bytes: []const u8, opcode: uwz.Opcode) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    const index = connection_index(server, ws) orelse return;
    if (server.sockets.is_paused(index)) {
        queues.count_dropped(&server.sockets);
        return;
    }
    const generation = server.slab.generation_at(index) orelse return;
    const kind: payload.Kind = switch (opcode) {
        .text => .text,
        else => .binary,
    };
    if (!queues.stage_inbound(&server.sockets, index, generation, kind, bytes)) return;
    _ = server.channel.emit(.{
        .kind = .connection_message,
        .server = server.handle.to_int(),
        .index = index,
        .generation = generation,
        .code = @intCast(bytes.len),
    });
}

fn on_close(slot: usize, ws: *uwz.WebSocket) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    const app = server.cluster.worker(0) orelse return;
    app.pubsub.unsubscribe_all(ws);
    const index = connection_index(server, ws) orelse return;
    if (!server.sockets.finish(index)) return;
    const handle = server.slab.release(index) orelse return;
    _ = server.channel.emit_terminal(.{
        .kind = .connection_close,
        .server = server.handle.to_int(),
        .index = handle.index,
        .generation = handle.generation,
    });
}

fn connection_index(server: *instance.Instance, ws: *uwz.WebSocket) ?u32 {
    const app = server.cluster.worker(0) orelse return null;
    const index = app.pool.index_of(ws.conn) orelse return null;
    return @intCast(index);
}
