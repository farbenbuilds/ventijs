//! The fragment boundaries of the message being reassembled.
//!
//! Split out of `receive.zig` because it is the one piece of that state that is a
//! policy rather than a buffer, and the policy is worth a file of its own: the list
//! is what lets a caller who asked for `binaryType: "fragments"` slice the
//! reassembled message without a second copy, and its length is what the compiled
//! `maxFragments` bound is applied to.
//!
//! **The count is the bound, not the byte total.** A peer that sends a megabyte in
//! one-byte fragments costs the same reassembly either way and vastly more per-frame
//! work, so the number of pieces is what a peer actually controls and what a limit on
//! that number is for. An unbounded list would be a peer's memory, which is why this
//! is comptime-sized and why exceeding it is a refusal rather than a growth.

/// The fragment boundaries of one message in progress.
///
/// Offsets are *end* positions and ascend, so `ends()[n]` is where the `n`th piece
/// stops. Recording ends rather than starts means a caller can slice the message
/// without knowing the first piece's length separately, and it means the last end is
/// the message length, which is a check the caller can make for free.
pub fn fragments(comptime max_fragments: usize) type {
    if (max_fragments == 0) @compileError("fragments need room for at least one piece");

    return struct {
        const Self = @This();

        ends_: [max_fragments]u32 = undefined,
        count: usize = 0,

        /// Records where a piece ended, or reports that the message is split into
        /// more of them than the bound allows.
        ///
        /// A `u32` because a boundary is an offset into a message whose size is
        /// already bounded by a `u32`-checked capacity, so the narrower type is free
        /// and halves what the boundary list costs per connection.
        pub fn note(self: *Self, end: usize) error{TooManyFragments}!void {
            if (self.count >= max_fragments) return error.TooManyFragments;
            self.ends_[self.count] = @intCast(end);
            self.count += 1;
        }

        /// The boundaries, ascending. Empty for a message that has not started.
        pub fn ends(self: *const Self) []const u32 {
            return self.ends_[0..self.count];
        }

        /// Forgets the boundaries, for a message that is starting or has ended.
        pub fn clear(self: *Self) void {
            self.count = 0;
        }
    };
}
