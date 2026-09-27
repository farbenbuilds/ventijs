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
const topic = @import("../server/topic.zig");
const instance = @import("../server/instance.zig");
const queues = @import("../socket/queues.zig");
const status = @import("../socket/status.zig");

/// Ordinal into `NATIVE_SOCKET_STATUSES` in `src/binding/native.ts`.
pub const Status = u8;

/// Hands staged payloads to the engine thread.
///
/// The ring is drained whole rather than per connection, and each record is
/// published to the topic derived from the index and generation it was staged
/// with, so a payload can never reach the wrong connection. Draining per
/// connection is not an option on a single-consumer FIFO ring: it would mean one
/// connection's staged payload blocks every other connection's until it is
/// pumped, and a connection that is never pumped again holds the ring's capacity
/// indefinitely.
///
/// The connection argument is still resolved, and still rejects a stale handle
/// with `invalid_handle`, so the caller's own connection is guaranteed to be one
/// the engine still knows about before any payload moves.
///
/// Returns `backpressure` when the engine's inbox refused a payload. The refused
/// bytes stay at the head of the ring rather than being freed, so a later pump
/// retries them; freeing them would turn a transient engine-inbox backlog into a
/// silently dropped message the application had already been told was accepted.
pub fn pump_socket(env: napi.Env, server: u40, connection: u64) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    _ = instance.resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(flush(target));
}

/// Inbound messages the inbound ring refused because the Node main thread had
/// not drained it. Non-zero means a peer outran JavaScript and messages were
/// lost, which the compatibility layer surfaces rather than hides.
pub fn server_dropped_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.sockets.inbound.dropped_count();
}

/// Removes the oldest parsed message and copies it into a JavaScript-owned
/// buffer.
///
/// The copy is what makes the payload safe to retain: the engine reuses its own
/// message buffer for the next frame and the ring slot is freed here, so no
/// engine memory is ever reachable from JavaScript. A null return means nothing
/// is staged, which is the normal case when a wakeup was coalesced or the event
/// channel dropped its notification.
///
/// The slot is released by a `defer` rather than on the success path alone. A
/// failed `createBuffer` or `createArrayWithLength` would otherwise return with
/// the record still claimed, and the ring head would stick on it for every later
/// take, stalling the inbound path permanently.
///
/// The result is a two-element `[buffer, isBinary]` array. The opcode travels
/// with the bytes rather than being read from the wakeup event because the two
/// queues are bounded separately: a dropped wakeup would otherwise pair one
/// message's opcode with the next message's bytes.
pub fn take_socket_message(env: napi.Env, server: u40, connection: u64) !?napi.Val {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    _ = instance.resolve_connection(target, connection) orelse return null;
    const view = queues.take_inbound(&target.sockets) orelse return null;
    defer queues.release_inbound(&target.sockets, view);
    const buffer = try env.createBuffer(view.bytes.len);
    @memcpy(buffer.data[0..view.bytes.len], view.bytes);
    const is_binary = try env.createBoolean(view.kind != .text);
    const result = try env.createArrayWithLength(2);
    try result.setElement(env, 0, buffer.val);
    try result.setElement(env, 1, is_binary);
    return result;
}

/// Publishes every staged payload, oldest first.
///
/// A payload the engine inbox refuses stays at the head of the ring rather than
/// being freed, so a refused send is still owed to the peer and a later pump
/// retries it. Freeing it would turn a transient engine-inbox backlog into a
/// silently dropped message the application had already been told was accepted.
fn flush(target: *instance.Instance) status.Status {
    while (queues.take_outbound(&target.sockets)) |view| {
        if (queue(target, view) == 0) return .backpressure;
        queues.release_outbound(&target.sockets, view);
    }
    return .ok;
}

fn queue(target: *instance.Instance, view: anytype) usize {
    var buffer: [topic.topic_capacity]u8 = undefined;
    const name = topic.write_topic(&buffer, view.index, view.generation);
    const is_text = view.kind == .text;
    return target.cluster.publish(name, view.bytes, is_text) catch 0;
}
