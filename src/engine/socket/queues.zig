//! Ring-facing transitions for one socket slab.
//!
//! Both payload rings are strictly FIFO across every connection on a server, and
//! a single-consumer ring cannot skip a head it does not own without breaking
//! that ordering. The two rings therefore differ, and the difference is
//! deliberate:
//!
//! - Outbound is drained whole. A staged record carries the index and generation
//!   it belongs to, and the engine topic is derived from them, so the publisher
//!   routes each payload to its own connection. Filtering by connection here
//!   would mean one connection's staged payload blocks every other connection's
//!   until it happens to be pumped, and a connection that is never pumped again
//!   holds the ring's capacity for the whole server.
//!
//! - Inbound is filtered by connection. Nothing routes an inbound payload: the
//!   consumer is told which connection to take a message from and is handed the
//!   bytes, so an unfiltered take would deliver one peer's message on another
//!   peer's socket. The cost is that a connection whose message sits behind
//!   another connection's has to wait for it to be drained first, which is a
//!   stall and not a leak. Per-connection inbound rings would remove the stall
//!   and are not implemented.
//!
//! No slot lock is taken to match a view. The generation to match against comes
//! from the handle the caller already resolved through the atomic slab word, and
//! the ring publishes each record behind its own sequence word, so the pair
//! being compared is the pair the producer wrote. `release_outbound` is the one
//! transition that touches the connection record, because `bufferedAmount` has
//! to be debited.

const payload = @import("payload.zig");

/// Copies a parsed inbound message into the server's inbound ring. Engine
/// thread only. A full ring drops the message and counts it: the engine reads
/// the next frame without waiting for JavaScript, so the buffer has to be
/// bounded somewhere.
///
/// Reports whether the message was staged, so the caller does not announce a
/// message that no consumer will ever find. Announcing a dropped one leaves
/// JavaScript waiting for bytes that were never staged, and the only evidence is
/// the drop counter.
pub fn stage_inbound(
    slab: anytype,
    index: u32,
    generation: u32,
    kind: payload.Kind,
    data: []const u8,
) bool {
    slab.inbound.stage(kind, index, generation, data) catch return false;
    return true;
}

/// Records one message the engine consumed but did not stage.
///
/// Used by the paused-connection path, where the engine has already read the
/// frame and there is nowhere to put it. Counting it is what makes
/// `serverDroppedMessages` mean what it says: an unpaused connection that filled
/// the ring and a paused one that asked to be paused are the same observable
/// event, and neither may be invisible.
pub fn count_dropped(slab: anytype) void {
    _ = slab.inbound.dropped.fetchAdd(1, .monotonic);
}

/// Borrows the oldest staged inbound message belonging to this connection, or
/// null when the ring is empty or the head belongs to someone else.
/// Node main thread only.
pub fn take_inbound(slab: anytype, index: u32, generation: u32) ?payload.View {
    const view = slab.inbound.peek() orelse return null;
    if (view.index != index or view.generation != generation) return null;
    return view;
}

/// Frees a borrowed inbound message. The caller must already hold a copy of the
/// bytes, because the engine reuses its own buffer for the next frame.
pub fn release_inbound(slab: anytype, view: payload.View) void {
    slab.inbound.release(view);
}

/// Drops every staged inbound message belonging to a connection that has closed,
/// and counts them. Node main thread only, and for the same reason `take_inbound`
/// is: the inbound ring has a single consumer, and adding a second one on the
/// engine thread would let two callers release the same head and leave
/// `dequeue_pos` pointing at an already-freed slot.
///
/// This is not a memory leak fix; the ring is fixed-capacity, so the bytes are
/// bounded either way. It is a starvation fix, and it is the difference between
/// a stall and a permanent outage.
///
/// Without it, a peer that sends a burst and disconnects leaves records for a
/// handle that `slab.release` has already retired. Nothing can match those
/// `(index, generation)` pairs again, so `take_inbound` returns null for them
/// forever, and because the ring is strictly FIFO with one consumer, a stranded
/// record at the head makes `take_inbound` return null for *every other
/// connection on the server*. `stage_inbound` then fails for all of them, the
/// drop counter climbs, and the server is permanently deaf while every connection
/// still looks healthy. Sixty-four messages and a disconnect is not an exotic
/// shape; it is what any burst-then-hangup does.
///
/// Only a leading run is removed, because the ring is ordered and a record behind
/// a live connection's cannot be reached without consuming that connection's
/// message, which would deliver one peer's data on another peer's socket. A
/// closing connection's records that sit behind live ones are therefore left for
/// the ordinary drain to overtake, which is the stall `queues`' module note
/// already describes and which per-connection inbound rings would remove.
pub fn discard_inbound(slab: anytype, index: u32, generation: u32) u32 {
    var dropped: u32 = 0;
    while (slab.inbound.peek()) |view| {
        if (view.index != index or view.generation != generation) break;
        slab.inbound.release(view);
        dropped += 1;
    }
    if (dropped == 0) return 0;
    _ = slab.inbound.dropped.fetchAdd(dropped, .monotonic);
    return dropped;
}

/// Borrows the oldest staged outbound message, or null when the ring is empty.
/// Node main thread only.
///
/// Not filtered by connection: the publisher routes on the record's own index and
/// generation, so the whole ring drains on any pump.
pub fn take_outbound(slab: anytype) ?payload.View {
    return slab.ring.peek();
}

/// Returns a borrowed outbound message to the ring and debits the owning
/// connection's buffered count. Call only after the engine has taken its own
/// copy, because the view borrows the slot this frees.
///
/// The generation is carried through so a payload released after its connection
/// recycled the slot cannot debit the new occupant's `bufferedAmount`.
pub fn release_outbound(slab: anytype, view: payload.View) void {
    const len: u32 = @intCast(view.bytes.len);
    slab.ring.release(view);
    slab.note_drained(view.index, view.generation, len);
}
