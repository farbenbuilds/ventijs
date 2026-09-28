//! The fragment boundaries of the message being reassembled. **The count is the bound, not the
//! byte total**: the number of pieces is what a peer controls, and exceeding it is a refusal.

const growth = @import("growth.zig");

/// Interior *end* positions of one message in progress, ascending; N pieces record N-1 ends.
pub const ends_are = "interior";

/// Boundaries reserved before a message is fragmented: sixteen is a chat-sized count and 64
/// bytes, so an unfragmented connection costs 64 bytes rather than 64 KiB.
pub const initial_boundaries = 16;

pub const fragments = struct {
    ends_: growth.buffer(u32) = .{},
    count: usize = 0,

    /// Releases the boundary list, which may never have been allocated.
    pub fn deinit(self: *fragments) void {
        self.ends_.deinit();
        self.count = 0;
    }

    /// Records where a piece ended, or reports too many pieces for the bound; both faults 1008.
    pub fn note(self: *fragments, end: usize, bound: usize) error{ TooManyFragments, OutOfMemory }!void {
        if (self.count >= bound) return error.TooManyFragments;
        if (self.count == self.ends_.items.len) {
            const grown = @min(@max(self.count * 2, initial_boundaries), bound);
            try self.ends_.reserve(grown, bound);
        }
        self.ends_.items[self.count] = @intCast(end);
        self.count += 1;
    }

    pub fn ends(self: *const fragments) []const u32 {
        return self.ends_.window(self.count);
    }

    /// Keeps the allocation: a peer that fragments one message will likely fragment the next.
    pub fn clear(self: *fragments) void {
        self.count = 0;
    }
};
