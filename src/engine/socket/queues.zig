//! Ring-facing transitions for one socket slab.
//!
//! Both payload rings are strictly FIFO across every connection on a server, so
//! a head owned by a different connection means this connection has nothing
//! ready right now. Every function here returns null in that case rather than
//! skipping the head, which would reorder another connection's message.
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
pub fn stage_inbound(
    slab: anytype,
    index: u32,
    generation: u32,
    kind: payload.Kind,
    data: []const u8,
) void {
    slab.inbound.stage(kind, index, generation, data) catch return;
}

/// Borrows the oldest staged inbound message belonging to this connection, or
/// null when the head belongs to someone else. Node main thread only.
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

/// Borrows the oldest staged outbound message belonging to this connection, or
/// null when the head belongs to someone else. Node main thread only.
pub fn take_outbound(slab: anytype, index: u32, generation: u32) ?payload.View {
    const view = slab.ring.peek() orelse return null;
    if (view.index != index or view.generation != generation) return null;
    return view;
}

/// Returns a borrowed outbound message to the ring and debits the connection's
/// buffered count. Call only after the engine has taken its own copy, because
/// the view borrows the slot this frees.
pub fn release_outbound(slab: anytype, view: payload.View) void {
    const len: u32 = @intCast(view.bytes.len);
    slab.ring.release(view);
    slab.note_drained(view.index, len);
}
