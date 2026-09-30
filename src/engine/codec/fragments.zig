//! The fragment boundaries of the message being reassembled. **The count is the bound, not the
//! byte total**: the number of pieces is what a peer controls, and exceeding it is a refusal.

const growth = @import("growth.zig");

/// Boundaries reserved before a message is fragmented: sixteen is a chat-sized count and 64
/// bytes, so an unfragmented connection costs 64 bytes rather than 64 KiB.
pub const initial_boundaries = 16;

/// Interior *end* positions of one message in progress, ascending; N pieces record N-1 ends.
pub const Fragments = struct {
    ends_: growth.buffer(u32) = .{},
    count: usize = 0,

    /// Releases the boundary list, which may never have been allocated.
    pub fn deinit(boundaries: *Fragments) void {
        boundaries.ends_.deinit();
        boundaries.count = 0;
    }

    /// Records where a piece ended, or reports too many pieces for the bound; both faults 1008.
    pub fn note(boundaries: *Fragments, end: usize, bound: usize) error{ TooManyFragments, OutOfMemory }!void {
        if (boundaries.count >= bound) return error.TooManyFragments;
        if (boundaries.count == boundaries.ends_.items.len) {
            const grown = @min(@max(boundaries.count * 2, initial_boundaries), bound);
            try boundaries.ends_.reserve(grown, bound);
        }
        boundaries.ends_.items[boundaries.count] = @intCast(end);
        boundaries.count += 1;
    }

    pub fn ends(boundaries: *const Fragments) []const u32 {
        return boundaries.ends_.window(boundaries.count);
    }

    /// Keeps the allocation: a peer that fragments one message will likely fragment the next.
    pub fn clear(boundaries: *Fragments) void {
        boundaries.count = 0;
    }
};
