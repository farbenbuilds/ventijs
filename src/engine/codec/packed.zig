//! The one atomic word a codec slot keeps its state and generation in, so a resolve can never pair a fresh generation with a stale state.

const std = @import("std");

pub const State = enum(u8) { free, active };

/// `generation << 8 | state`, so a reader checks the lifecycle without shifting; the generation
/// has 56 bits and wraps after 2^56 acquisitions on one slot.
pub fn pack(lifecycle: State, generation: u32) u64 {
    return (@as(u64, generation) << 8) | @intFromEnum(lifecycle);
}

/// The state comes from the low byte and an unrecognised byte is `unreachable`: `pack` is the only writer.
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
    // An acquire load and a release store must make both halves visible together, so the word
    // is a real atomic and not a plain u64.
    std.debug.assert(@sizeOf(std.atomic.Value(u64)) == @sizeOf(u64));
}
