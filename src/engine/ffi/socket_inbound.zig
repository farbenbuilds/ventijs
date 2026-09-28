//! Reading parsed frames back out to JavaScript, and reclaiming the ring space a
//! departed connection leaves behind.
//!
//! Both entry points are consumers of the same single-consumer FIFO, which is the
//! constraint that shapes the purge: adding a second consumer on the engine
//! thread would let two callers release the same head and leave `dequeue_pos`
//! pointing at an already-freed slot, so everything here is Node main thread only,
//! the same role `socket_pump` plays on the outbound side.

const napi = @import("napi-zig");
const instance = @import("../server/instance.zig");
const queues = @import("../socket/queues.zig");
const handles = @import("../socket/handles.zig");

/// Removes the oldest parsed message and copies it into a JavaScript-owned
/// buffer.
///
/// The copy is what makes the payload safe to retain: the engine reuses its own
/// message buffer for the next frame and the ring slot is freed here, so no
/// engine memory is ever reachable from JavaScript. A null return means nothing
/// is staged, which is the normal case when a wakeup was coalesced or the event
/// channel dropped its notification.
///
/// **The connection handle is not resolved.** A peer that sends a message and a
/// close frame in one read has both staged before Node runs, and `on_close`
/// releases the slab slot on the engine thread, so by the time the take happens
/// the handle is stale and the message is unreachable: a parsed message the
/// application never sees. The record carries the `(index, generation)` it was
/// staged with and `take_inbound` matches on that, so a released connection's
/// message is still that connection's message. A pair that matches nothing
/// returns null, and a slot that has since been reused is a different
/// generation, so no record can be claimed twice.
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

/// Drops the staged inbound messages of a connection that has closed.
///
/// This deliberately does **not** resolve a connection handle. The connection is
/// already gone, and that is the whole reason the call exists: a handle would
/// resolve to null precisely when the purge is needed, and resolving it would
/// also mean the ring records belonging to a live connection could be dropped by
/// a caller holding a stale handle. The caller passes the index and generation
/// from the `connection_close` event, and the guard below refuses any pair the
/// slab still considers live, so a purge can only ever target a connection the
/// engine has already released.
///
/// Returns how many messages were dropped. They are added to the same counter as
/// a refused stage and a paused-connection drop, because all three are the same
/// observable event: the engine parsed a message and no consumer will ever see
/// it. A separate number here would be a second thing nothing reads.
pub fn purge_socket_message(env: napi.Env, server: u40, index: u32, generation: u32) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    if (target.slab.generation_at(index)) |live| {
        if (live == generation) return 0;
    }
    return queues.discard_inbound(&target.sockets, index, generation);
}

/// Inbound messages lost before JavaScript could see them, from any of the three
/// causes: a stage the ring refused, a message from a connection the application
/// paused, and a purge of a connection that closed with messages still staged.
///
/// All three are a peer outrunning the consumer and all three are invisible from
/// JavaScript otherwise, so they share the one counter rather than each having a
/// number nothing reads. A paused connection is bounded to itself; a full ring and
/// an abandoned connection are not.
pub fn server_dropped_messages(env: napi.Env, server: u40) !u64 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    return target.sockets.inbound.dropped_count();
}
