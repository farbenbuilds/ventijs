//! Ring-facing transitions for one socket slab.
//!
//! Both payload rings are strictly FIFO across every connection on a server, so
//! ownership of the head belongs to whichever connection staged it. Neither
//! borrow function filters by connection: a consumer that skipped a head it did
//! not own would break the ring's ordering, so the only safe primitive is
//! "take the head, whoever owns it". Routing is the publisher's job, because a
//! staged record already carries the index and generation it belongs to and the
//! engine topic is derived from them.
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

/// Borrows the oldest staged inbound message, or null when the ring is empty.
/// Node main thread only.
pub fn take_inbound(slab: anytype) ?payload.View {
    return slab.inbound.peek();
}

/// Frees a borrowed inbound message. The caller must already hold a copy of the
/// bytes, because the engine reuses its own buffer for the next frame.
pub fn release_inbound(slab: anytype, view: payload.View) void {
    slab.inbound.release(view);
}

/// Borrows the oldest staged outbound message, or null when the ring is empty.
/// Node main thread only.
///
/// Not filtered by connection. A single-consumer FIFO ring cannot skip a head it
/// does not own, so filtering here would mean one connection's staged payload
/// blocks every other connection's until it is pumped, and a connection that is
/// never pumped again — a closed one, or one whose peer stopped reading — would
/// hold its bytes and the whole ring's capacity indefinitely.
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
