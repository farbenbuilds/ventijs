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

const std = @import("std");
const uwz = @import("uWebZockets");
const instance = @import("instance.zig");
const payload = @import("../socket/payload.zig");
const queues = @import("../socket/queues.zig");

/// Topic prefix for one connection's outbound channel. The engine's topic
/// registry caps names at 127 bytes and rejects an empty one, so the prefix is
/// fixed and only the index and generation follow. Twenty bytes is a generous
/// bound for two `u32` values written in decimal plus the separator.
pub const TOPIC_PREFIX = "ventijs:conn:";
pub const topic_capacity = TOPIC_PREFIX.len + 20;

/// Writes the topic name for one connection generation. Two generations of the
/// same slot get different topics, so a payload staged by a closed connection
/// can never be delivered to the connection that recycled its slot.
pub fn write_topic(buffer: *[topic_capacity]u8, index: u32, generation: u32) []const u8 {
    const written = std.fmt.bufPrint(buffer, TOPIC_PREFIX ++ "{d}:{d}", .{ index, generation }) catch unreachable;
    return written;
}

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
    subscribe(server, ws, index, handle.generation);
    _ = server.channel.emit(.{
        .kind = .connection_open,
        .server = server.handle.to_int(),
        .index = handle.index,
        .generation = handle.generation,
    });
}

/// Copies one parsed message into the server's inbound ring and wakes the Node
/// main thread. The bytes only borrow the engine's own message buffer for the
/// duration of this call, so the copy is what makes the payload survive past
/// the callback.
///
/// A paused connection drops here rather than in the compatibility layer, so a
/// `pause()` stops staging and not merely stops dispatch. A full ring also
/// drops: the engine reads the next frame without waiting for JavaScript, so
/// the buffer has to be bounded somewhere.
fn on_message(slot: usize, ws: *uwz.WebSocket, bytes: []const u8, opcode: uwz.Opcode) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    const index = connection_index(server, ws) orelse return;
    if (server.sockets.is_paused(index)) return;
    const generation = server.slab.generation_at(index) orelse return;
    const kind: payload.Kind = switch (opcode) {
        .text => .text,
        else => .binary,
    };
    queues.stage_inbound(&server.sockets, index, generation, kind, bytes);
    _ = server.channel.emit(.{
        .kind = .connection_message,
        .server = server.handle.to_int(),
        .index = index,
        .generation = generation,
        .code = @intCast(bytes.len),
    });
}

/// Subscribes the engine socket to its outbound topic. Engine thread only: the
/// subscription table is read by the topic publisher on this same thread.
fn subscribe(server: *instance.Instance, ws: *uwz.WebSocket, index: u32, generation: u32) void {
    const app = server.cluster.worker(0) orelse return;
    var buffer: [topic_capacity]u8 = undefined;
    app.pubsub.subscribe(ws, write_topic(&buffer, index, generation)) catch {};
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
