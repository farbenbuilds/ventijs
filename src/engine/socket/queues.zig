//! Both rings are strictly FIFO across every connection, so a single-consumer ring cannot
//! skip a head it does not own: outbound routes by each record's `(index, generation)`, inbound filters.

const payload = @import("payload.zig");

/// Engine thread only; a full ring drops and counts, since the engine reads the next frame
/// without waiting on JavaScript. Returns the staged record's sequence so the announcement
/// carries the identity the consumer matches on, or null when nothing was staged.
pub fn stage_inbound(
    slab: anytype,
    index: u32,
    generation: u32,
    kind: payload.Kind,
    data: []const u8,
) ?u64 {
    slab.inbound.stage(kind, index, generation, data) catch return null;
    // One producer per inbound ring (the server's engine thread), so the only claim that
    // could have advanced the tail is the one that just succeeded.
    return slab.inbound.enqueue_pos.load(.monotonic) -% 1;
}

/// A paused connection and a full ring are the same observable event, so one counter.
pub fn count_dropped(slab: anytype) void {
    _ = slab.inbound.dropped.fetchAdd(1, .monotonic);
}

/// Node main thread only: a second consumer would let two callers release the same head.
/// `announced` is the staged sequence the `connection_message` event being handled carried,
/// so a record whose own event the channel dropped is skipped instead of being handed over
/// as the newer message. A leading record of another connection whose generation is gone is
/// skipped too, or one departed peer would deafen the whole server. Both skips count as
/// inbound loss.
pub fn take_inbound(
    sockets: anytype,
    connections: anytype,
    index: u32,
    generation: u32,
    announced: ?u32,
) ?payload.View {
    while (sockets.inbound.peek()) |view| {
        if (view.index == index and view.generation == generation) {
            const expected = announced orelse return view;
            // Live records span at most one full ring, far under 2^31, so the wrapping
            // low-word delta orders them even after the 64-bit sequence wraps.
            const delta: i32 = @bitCast(@as(u32, @truncate(view.sequence)) -% expected);
            if (delta < 0) {
                sockets.inbound.release(view);
                count_dropped(sockets);
                continue;
            }
            // A newer record has its own event; this take is late for a record already gone.
            if (delta > 0) return null;
            return view;
        }
        // A record of another connection blocks only while its generation is live: a dead
        // one can never be claimed by an event again, so waiting for it is permanent
        // deafness. The requested pair takes no such check -- a message and a close in one
        // read stage the message before the engine thread releases the slot.
        if (connection_live(connections, view)) return null;
        sockets.inbound.release(view);
        count_dropped(sockets);
    }
    return null;
}

fn connection_live(connections: anytype, view: payload.View) bool {
    const live = connections.generation_at(view.index) orelse return false;
    return live == view.generation;
}

/// The caller must already hold a copy; the engine reuses its buffer for the next frame.
pub fn release_inbound(slab: anytype, view: payload.View) void {
    slab.inbound.release(view);
}

/// Drops a closed connection's staged inbound records, counting them. A dead generation
/// no longer deafens anyone -- `take_inbound` skips it -- but it would sit in the ring
/// until some later take walked past it, and the close event is the one moment the
/// records are known unreachable; releasing the leading run there frees the slots at
/// once. Only a leading run is removed.
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
