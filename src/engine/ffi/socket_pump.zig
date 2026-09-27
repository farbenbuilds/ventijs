//! The engine-thread drain: moving staged bytes onto the wire.
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
//! frames cannot, and `can_publish` refuses them rather than letting a control
//! record reach the peer as application data. The inbound half of this boundary
//! is `socket_inbound.zig`.

const napi = @import("napi-zig");
const topic = @import("../server/topic.zig");
const instance = @import("../server/instance.zig");
const payload = @import("../socket/payload.zig");
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

/// Staged payloads the engine refused after the pump had already taken them out
/// of the ring, and payloads it refused because the connection had no
/// subscription.
///
/// This is the outbound counterpart of `socket_inbound.server_dropped_messages`,
/// and it exists because the outbound path had no honest answer: the pump
/// reported `ok` for a payload the engine then discarded. A caller that watches
/// only the status saw success; a caller that watches only `bufferedAmount` saw
/// the bytes debited. The two counters together are the difference between "sent"
/// and "reported sent".
pub fn server_undelivered_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.undelivered.load(.acquire);
}

/// Publishes every staged payload, oldest first.
///
/// A payload the engine inbox refuses stays at the head of the ring rather than
/// being freed, so a refused send is still owed to the peer and a later pump
/// retries it. Freeing it would turn a transient engine-inbox backlog into a
/// silently dropped message the application had already been told was accepted.
///
/// A refusal is counted rather than merely reported. `Cluster.publish` returns
/// the number of worker inboxes it queued, not the number of sockets written, and
/// the far end discards a send error outright, so a full connection write queue
/// used to end with the record freed, the slot debited, and `ok` returned: the
/// bytes were gone and the application had been told they were sent. The counter
/// is the only place that loss is observable.
fn flush(target: *instance.Instance) status.Status {
    while (queues.take_outbound(&target.sockets)) |view| {
        if (!can_publish(view.kind)) return .policy_violation;
        if (queue(target, view) == 0) {
            _ = target.undelivered.fetchAdd(1, .monotonic);
            return .backpressure;
        }
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

/// Whether a staged record can make the topic hop at all.
///
/// The topic publisher maps a message onto a text or binary opcode and nothing
/// else, so a control record staged by the compatibility layer has no opcode to
/// travel as. Publishing one anyway is not a silent drop, it is worse: a staged
/// close frame becomes a binary message carrying the close code and reason as
/// payload, so the peer receives `[0x03, 0xE8]` as application data and never
/// sees a close frame at all.
///
/// `payload.Kind` has carried `ping`, `pong`, and `close` since the staging ring
/// was introduced, and nothing filtered them here. The bug was dormant only
/// because no file under `src/compat/` reached the pump, which is exactly the
/// condition the frame codec removes, so the filter has to land first.
///
/// The records are refused rather than dropped so the ring slot is not freed: the
/// payload stays owed to its connection and a later drain can route it through a
/// path that carries a real opcode. That is why this returns a status instead of
/// consuming the view.
fn can_publish(kind: payload.Kind) bool {
    return switch (kind) {
        .text, .binary => true,
        .ping, .pong, .close => false,
    };
}
