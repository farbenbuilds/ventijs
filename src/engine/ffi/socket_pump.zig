//! The engine-thread drain: moving staged bytes onto the wire and parsed
//! frames back out to JavaScript.
//!
//! Staging a payload is not sending it. `send_socket` copies bytes into a
//! bounded ring on the Node main thread, and nothing about that reaches the
//! socket until `pump_socket` runs. The hop is a cross-thread one, so it goes
//! through the engine's own cluster inbox: the pump pushes a payload and wakes
//! the engine thread, and the engine's topic publisher writes it to the socket
//! subscribed to that connection's topic.
//!
//! The topic publisher maps a message onto a text or binary opcode and nothing
//! else, so only those two opcodes can make this hop. Close, ping, and pong
//! frames cannot, and are refused by the compatibility layer rather than
//! silently dropped here.

const napi = @import("napi-zig");
const connections = @import("../server/connections.zig");
const instance = @import("../server/instance.zig");
const queues = @import("../socket/queues.zig");
const status = @import("../socket/status.zig");

/// Ordinal into `NATIVE_SOCKET_STATUSES` in `src/binding/native.ts`.
pub const Status = u8;

/// Hands one connection's staged payloads to the engine thread.
///
/// Returns `backpressure` when the engine's inbox refused a payload. The refused
/// bytes are still staged, so the caller can retry; `bufferedAmount` keeps
/// counting them, which is the same signal `ws` gives for a send it could not
/// hand to the socket yet.
pub fn pump_socket(env: napi.Env, server: u40, connection: u64) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = instance.resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(flush(target, handle.index, handle.generation));
}

/// Inbound messages the inbound ring refused because the Node main thread had
/// not drained it. Non-zero means a peer outran JavaScript and messages were
/// lost, which the compatibility layer surfaces rather than hides.
pub fn server_dropped_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.sockets.inbound.dropped_count();
}

/// Removes the oldest parsed message staged for a connection and copies it into
/// a JavaScript-owned buffer.
///
/// The copy is what makes the payload safe to retain: the engine reuses its own
/// message buffer for the next frame and the ring slot is freed here, so no
/// engine memory is ever reachable from JavaScript. A null return means nothing
/// is staged, which is the normal case when a wakeup was coalesced or the event
/// channel dropped its notification.
///
/// The result is a two-element `[buffer, isBinary]` array. The opcode travels
/// with the bytes rather than being read from the wakeup event because the two
/// queues are bounded separately: a dropped wakeup would otherwise pair one
/// message's opcode with the next message's bytes.
pub fn take_socket_message(env: napi.Env, server: u40, connection: u64) !?napi.Val {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = instance.resolve_connection(target, connection) orelse return null;
    const view = queues.take_inbound(&target.sockets, handle.index, handle.generation) orelse return null;
    const buffer = try env.createBuffer(view.bytes.len);
    @memcpy(buffer.data[0..view.bytes.len], view.bytes);
    const is_binary = try env.createBoolean(view.kind != .text);
    const result = try env.createArrayWithLength(2);
    try result.setElement(env, 0, buffer.val);
    try result.setElement(env, 1, is_binary);
    queues.release_inbound(&target.sockets, view);
    return result;
}

/// Publishes every payload staged for one connection, oldest first.
///
/// A payload the engine inbox refuses stays at the head of the ring rather than
/// being freed, so a refused send is still owed to the peer and a later pump
/// retries it. Freeing it would turn a transient engine-inbox backlog into a
/// silently dropped message the application had already been told was accepted.
fn flush(target: *instance.Instance, index: u32, generation: u32) status.Status {
    while (queues.take_outbound(&target.sockets, index, generation)) |view| {
        if (queue(target, view) == 0) return .backpressure;
        queues.release_outbound(&target.sockets, view);
    }
    return .ok;
}

fn queue(target: *instance.Instance, view: anytype) usize {
    var buffer: [connections.topic_capacity]u8 = undefined;
    const topic = connections.write_topic(&buffer, view.index, view.generation);
    const is_text = view.kind == .text;
    return target.cluster.publish(topic, view.bytes, is_text) catch 0;
}
