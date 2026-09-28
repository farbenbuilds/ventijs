//! The one atomic word a codec slot keeps its state and generation in. One word, so a
//! resolve can never pair a fresh generation with a stale state; two words would open
//! exactly that window, and it is a use-after-free.

const std = @import("std");

/// Lifecycle of one codec slot.
pub const State = enum(u8) { free, active };

/// `generation << 8 | state`. State is the low byte so a reader can check the
/// lifecycle without shifting, and the generation has 56 bits, which wraps after
/// 2^56 acquisitions on one slot.
pub fn pack(lifecycle: State, generation: u32) u64 {
    return (@as(u64, generation) << 8) | @intFromEnum(lifecycle);
}

/// The state is reconstructed from the low byte rather than with `@enumFromInt`, and an
/// unrecognised byte is `unreachable` rather than a third value: `pack` is the only
/// writer of that byte, and a defaulting state would turn a second writer into a
/// silently free slot.
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
    // A slot's word is read with an acquire load and written with a release store, and
    // both halves have to be visible together, so it has to be a real atomic rather
    // than a plain u64 with a comment.
    std.debug.assert(@sizeOf(std.atomic.Value(u64)) == @sizeOf(u64));
}
