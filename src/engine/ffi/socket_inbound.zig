const napi = @import("napi-zig");
const instance = @import("../server/instance.zig");
const queues = @import("../socket/queues.zig");
const handles = @import("../socket/handles.zig");

/// **The connection handle is deliberately not resolved.** A peer that sends a message and a
/// close in one read has both staged before Node runs, and `on_close` frees the slab slot on
/// the engine thread, so resolving the handle at take time loses the message. The record
/// carries the `(index, generation)` it was staged with and the take matches on that.
pub fn take_socket_message(env: napi.Env, server: u40, connection: u64) !?napi.Val {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = handles.Handle.from_int(connection);
    const view = queues.take_inbound(&target.sockets, handle.index, handle.generation) orelse {
        return null;
    };
    defer queues.release_inbound(&target.sockets, view);
    const buffer = try env.createBuffer(view.bytes.len);
    @memcpy(buffer.data[0..view.bytes.len], view.bytes);
    const is_binary = try env.createBoolean(view.kind != .text);
    const result = try env.createArrayWithLength(2);
    try result.setElement(env, 0, buffer.val);
    try result.setElement(env, 1, is_binary);
    return result;
}

/// This deliberately does **not** resolve a connection handle, for the opposite reason: the
/// connection is already gone, so a handle resolves to null exactly when the purge is needed,
/// and a stale one could drop a live connection's records. The caller passes the index and
/// generation from `connection_close` and the guard below refuses any pair the slab calls live.
pub fn purge_socket_message(env: napi.Env, server: u40, index: u32, generation: u32) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    if (target.slab.generation_at(index)) |live| {
        if (live == generation) return 0;
    }
    return queues.discard_inbound(&target.sockets, index, generation);
}

/// All three loss causes are a peer outrunning the consumer, so they share one counter.
pub fn server_dropped_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.sockets.inbound.dropped_count();
}
