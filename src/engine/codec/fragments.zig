//! The fragment boundaries of the message being reassembled.
//!
//! Split out of `receive.zig` because it is the one piece of that state that is a
//! policy rather than a buffer, and the policy is worth a file of its own: the list
//! is what lets a caller who asked for `binaryType: "fragments"` slice the
//! reassembled message without a second copy, and its length is what the
//! `maxFragments` bound is applied to.
//!
//! **The count is the bound, not the byte total.** A peer that sends a megabyte in
//! one-byte fragments costs the same reassembly either way and vastly more per-frame
//! work, so the number of pieces is what a peer actually controls and what a limit on
//! that number is for. An unbounded list would be a peer's memory, which is why this
//! is grown on demand and why exceeding the bound is a refusal rather than a growth.
//!
//! **It grows on demand, and that is not only about the ceiling.** This list was a
//! `comptime`-sized `[16384]u32`, which is 64 KiB reserved on every connection
//! whether or not a single message was ever fragmented, and 64 KiB is twice the
//! 32 KiB message buffer it sat beside. A connection that never sees a fragmented
//! message paid for 16384 boundaries it never used. `ws` uses the same default
//! number, but `ws` does not reserve it up front either.

const growth = @import("growth.zig");

/// The fragment boundaries of one message in progress.
///
/// Offsets are *end* positions and ascend, so `ends()[n]` is where the `n`th piece
/// stops.
///
/// **Interior boundaries only.** A message of N pieces records N-1 of them, because the
/// last piece runs to the end of the reassembly buffer and the caller already has that
/// length. Recording it as well would make the list one longer than the number of cuts
/// in the message, and a caller slicing on it would produce an empty final piece.
pub const ends_are = "interior";

/// How many boundaries a connection reserves before a message is fragmented.
///
/// Sixteen is a chat-sized fragment count and 64 bytes, so a connection that never
/// sees fragmentation costs 64 bytes rather than 64 KiB. Growth from here is
/// geometric, so a peer that really does send 16384 fragments reaches it in about
/// eleven reallocations rather than in one reservation per connection up front.
pub const initial_boundaries = 16;

pub const fragments = struct {
    ends_: growth.buffer(u32) = .{},
    count: usize = 0,

    /// Releases the boundary list, which may never have been allocated.
    pub fn deinit(self: *fragments) void {
        self.ends_.deinit();
        self.count = 0;
    }

    /// Records where a piece ended, or reports that the message is split into
    /// more of them than the bound allows.
    ///
    /// A `u32` because a boundary is an offset into a message whose size is
    /// bounded by a `u32`-checked `maxPayload`, so the narrower type is free and
    /// halves what the boundary list costs per connection.
    /// A `TooManyFragments` is a policy failure the caller closes 1008 on, and an
    /// allocation failure is a process fault it closes 1008 on as well because the
    /// boundary is the same message to a peer either way. The two are therefore one
    /// error set here, and the caller has no reason to tell them apart.
    pub fn note(self: *fragments, end: usize, bound: usize) error{ TooManyFragments, OutOfMemory }!void {
        if (self.count >= bound) return error.TooManyFragments;
        if (self.count == self.ends_.items.len) {
            const grown = @min(@max(self.count * 2, initial_boundaries), bound);
            try self.ends_.reserve(grown, bound);
        }
        self.ends_.items[self.count] = @intCast(end);
        self.count += 1;
    }

    /// The boundaries, ascending. Empty for a message that has not started.
    pub fn ends(self: *const fragments) []const u32 {
        return self.ends_.window(self.count);
    }

    /// Forgets the boundaries, for a message that is starting or has ended. The
    /// allocation stays, because a peer that fragments one message is likely to
    /// fragment the next and the list is the same size either way.
    pub fn clear(self: *fragments) void {
        self.count = 0;
    }
};
