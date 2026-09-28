//! Both rings are strictly FIFO across every connection, so a single-consumer ring cannot
//! skip a head it does not own: outbound routes by each record's `(index, generation)`, inbound filters.

const payload = @import("payload.zig");

/// Engine thread only; a full ring drops and counts, since the engine reads the next frame
/// without waiting on JavaScript. Returns whether it staged, so nothing is announced unfindable.
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

/// A paused connection and a full ring are the same observable event, so one counter.
pub fn count_dropped(slab: anytype) void {
    _ = slab.inbound.dropped.fetchAdd(1, .monotonic);
}

/// Node main thread only: a second consumer would let two callers release the same head.
pub fn take_inbound(slab: anytype, index: u32, generation: u32) ?payload.View {
    const view = slab.inbound.peek() orelse return null;
    if (view.index != index or view.generation != generation) return null;
    return view;
}

/// The caller must already hold a copy; the engine reuses its buffer for the next frame.
pub fn release_inbound(slab: anytype, view: payload.View) void {
    slab.inbound.release(view);
}

/// Drops a closed connection's staged inbound records, counting them. A stranded record
/// at the head of this strictly-FIFO single-consumer ring makes `take_inbound` return
/// null for every connection on the server, so without this it is a permanent deafness,
/// not a leak. Only a leading run is removed.
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

/// Unfiltered: the publisher routes on the record's own index and generation.
pub fn take_outbound(slab: anytype) ?payload.View {
    return slab.ring.peek();
}

/// The view borrows the slot this frees, and the generation is carried through so a late
/// release cannot debit the slot's new occupant.
pub fn release_outbound(slab: anytype, view: payload.View) void {
    const len: u32 = @intCast(view.bytes.len);
    slab.ring.release(view);
    slab.note_drained(view.index, view.generation, len);
}
