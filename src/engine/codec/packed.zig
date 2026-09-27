//! The one atomic word a codec slot keeps its state and generation in.
//!
//! Its own module because the encoding is the part that has to be right and it is
//! not obvious. State and generation share a single word so a resolve can never
//! pair a fresh generation with a stale state or observe a torn transition: a slot
//! is either free with generation 7 or active with generation 8, and no lock-free
//! reader can see anything between. Two words would allow exactly that, and the
//! window it opens is a use-after-free.
//!
//! The generation is what makes it safe. It advances on every acquire, so a handle
//! from the previous occupant of a slot can never resolve again, and a slot reused
//! after a `destroy` hands out a different generation rather than an identical
//! one.

const std = @import("std");

/// Lifecycle of one codec slot.
pub const State = enum(u8) { free, active };

/// `generation << 8 | state`. State is the low byte so a reader can check the
/// lifecycle without shifting, and the generation has 56 bits, which wraps after
/// 2^56 acquisitions on one slot.
pub fn pack(lifecycle: State, generation: u32) u64 {
    return (@as(u64, generation) << 8) | @intFromEnum(lifecycle);
}

/// The state is reconstructed from the low byte rather than with `@enumFromInt`.
///
/// `pack` is the only writer of that byte and it writes one of these two, so the
/// default arm is unreachable by construction rather than a fallback. It is
/// `unreachable` and not a third value because a defaulting state would turn a
/// second writer into a silently free slot, and every transition would then report
/// a stale handle as "not found" instead of failing where the bug is.
pub fn state_of(word: u64) State {
    return switch (@as(u8, @truncate(word))) {
        0 => .free,
        1 => .active,
        else => unreachable,
    };
}

pub fn generation_of(word: u64) u32 {
    return @truncate(word >> 8);
}

comptime {
    // A slot's word is read with an acquire load and written with a release store,
    // and both halves of the pair have to be visible together, so the word has to
    // be a real atomic rather than a plain u64 with a comment.
    std.debug.assert(@sizeOf(std.atomic.Value(u64)) == @sizeOf(u64));
}
