//! Staging copies bytes into a bounded ring; nothing reaches the socket until
//! `pump_socket` publishes each record to the topic derived from its own
//! `(index, generation)`. The inbound half is `socket_inbound.zig`.

const napi = @import("napi-zig");
const topic = @import("../server/topic.zig");
const instance = @import("../server/instance.zig");
const payload = @import("../socket/payload.zig");
const queues = @import("../socket/queues.zig");
const status = @import("../socket/status.zig");

/// Ordinal into `NATIVE_SOCKET_STATUSES` in `src/binding/native.ts`.
pub const Status = u8;

/// The connection argument is still resolved, so a stale handle is rejected with
/// `invalid_handle` before any payload moves. Returns `backpressure` when the engine's
/// inbox refused a payload.
pub fn pump_socket(env: napi.Env, server: u40, connection: u64) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    _ = instance.resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(flush(target));
}

/// Staged payloads the engine refused. The outbound counterpart of
/// `socket_inbound.server_dropped_messages`: the pump reported `ok` for bytes the engine
/// then discarded, so this is where the loss becomes observable.
pub fn server_undelivered_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.undelivered.load(.acquire);
}

/// Publishes every staged payload, oldest first. A payload the engine inbox
/// refuses is counted and left at the head, so a later pump retries it.
fn flush(target: *instance.Instance) status.Status {
    while (queues.take_outbound(&target.sockets)) |view| {
        if (!can_publish(view.kind)) {
            queues.release_outbound(&target.sockets, view);
            _ = target.undelivered.fetchAdd(1, .monotonic);
            return .policy_violation;
        }
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

/// Whether a staged record can make the topic hop: the publisher maps a message onto a
/// text or binary opcode and nothing else, so a staged close frame would reach the peer
/// as a binary message carrying `[0x03, 0xE8]` as payload and it would never see a close
/// frame.
fn can_publish(kind: payload.Kind) bool {
    return switch (kind) {
        .text, .binary => true,
        .ping, .pong, .close => false,
    };
}
