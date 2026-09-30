//! Unit tests for `src/engine/channel/ring.zig`.

const std = @import("std");
const ring_module = @import("../../engine/channel/ring.zig");

const capacity = 8;
const terminal_reserve = 4;
const shutdown_reserve = 2;
const Ring = ring_module.event_ring(capacity, terminal_reserve, shutdown_reserve);

test "the ring refuses to overrun while the main thread lags" {
    var ring = Ring{};
    var reserved: u32 = 0;
    while (ring.reserve() != null) reserved += 1;
    try std.testing.expectEqual(@as(u32, capacity - terminal_reserve), reserved);
    try std.testing.expectEqual(@as(u64, 1), ring.dropped_count());
    try std.testing.expectEqual(@as(u64, capacity - terminal_reserve), ring.pending());
}

test "close events may use the terminal tail" {
    var ring = Ring{};
    while (ring.reserve() != null) {}

    var closes: u32 = 0;
    while (ring.reserve_terminal() != null) closes += 1;
    try std.testing.expectEqual(@as(u32, terminal_reserve - shutdown_reserve), closes);
    try std.testing.expectEqual(@as(u64, capacity - shutdown_reserve), ring.pending());
}

test "a close-event flood cannot consume the shutdown pair" {
    var ring = Ring{};
    while (ring.reserve() != null) {}
    while (ring.reserve_terminal() != null) {}

    try std.testing.expectEqual(@as(?u64, null), ring.reserve());
    try std.testing.expectEqual(@as(?u64, null), ring.reserve_terminal());
    try std.testing.expect(ring.reserve_shutdown() != null);
    try std.testing.expect(ring.reserve_shutdown() != null);
    try std.testing.expectEqual(@as(?u64, null), ring.reserve_shutdown());
    try std.testing.expectEqual(@as(u64, capacity), ring.pending());
}

test "completing a reservation frees the slot for the next sequence" {
    var ring = Ring{};
    const first = ring.reserve().?;
    ring.complete(first);

    var reserved: u32 = 1;
    while (ring.reserve() != null) reserved += 1;
    try std.testing.expectEqual(@as(u32, capacity - terminal_reserve + 1), reserved);
    try std.testing.expectEqual(@as(u64, capacity - terminal_reserve), ring.pending());
}

test "a dropped reservation no longer blocks finalize" {
    var ring = Ring{};
    const dropped = ring.reserve().?;
    ring.drop(dropped);
    try std.testing.expectEqual(@as(u64, 0), ring.pending());
    try std.testing.expectEqual(@as(u64, 1), ring.dropped_count());
}

test "a dropped reservation still holds its slot against reuse" {
    var ring = Ring{};
    var dropped: u32 = 0;
    while (ring.reserve()) |sequence| {
        ring.drop(sequence);
        dropped += 1;
    }
    try std.testing.expectEqual(@as(u32, capacity - terminal_reserve), dropped);
    try std.testing.expectEqual(@as(u64, 0), ring.pending());
    // One dropped per reservation plus the refused claim that ended the loop.
    try std.testing.expectEqual(@as(u64, dropped + 1), ring.dropped_count());
    try std.testing.expectEqual(@as(?u64, null), ring.reserve());
}

test "completion is monotonic" {
    var ring = Ring{};
    for (0..4) |_| {
        const sequence = ring.reserve().?;
        ring.complete(sequence);
    }
    const completed = ring.completed.load(.acquire);
    ring.complete(0);
    try std.testing.expectEqual(completed, ring.completed.load(.acquire));
}

test "sequence indexes wrap within the power-of-two ring" {
    var ring = Ring{};
    var last: u64 = 0;
    for (0..capacity) |_| {
        const sequence = ring.reserve().?;
        last = sequence;
        ring.complete(sequence);
    }
    try std.testing.expectEqual(@as(u64, capacity - 1), last);

    const wrapped = ring.reserve().?;
    try std.testing.expectEqual(@as(u64, capacity), wrapped);
    try std.testing.expectEqual(@as(u64, 0), wrapped & (capacity - 1));
}

test "an overtaken abandoned reservation cannot wrap pending" {
    // The only drop path abandons the newest reservation and closes the channel, so a
    // later completion cannot overtake it in service. The arithmetic still must not
    // report ~2^64 pending, which would pin `finalize` on `EventsPending` forever.
    var ring = Ring{};
    const stale = ring.reserve().?;
    ring.drop(stale);
    const live = ring.reserve().?;
    ring.complete(live);
    try std.testing.expectEqual(@as(u64, 0), ring.pending());
}
