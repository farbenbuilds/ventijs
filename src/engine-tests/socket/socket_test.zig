//! Unit tests for the `src/engine/socket/socket.zig` state machine.

const std = @import("std");
const payload = @import("../../engine/socket/payload.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);

test "send is refused once closing and closed" {
    var slab = Slab{};
    slab.open(2, 7);

    try std.testing.expectEqual(socket.Status.ok, slab.close(2, 7, 1000, ""));
    try std.testing.expectEqual(socket.Status.closing, slab.send(2, 7, .text, "late"));
    try std.testing.expect(slab.finish(2));
    try std.testing.expectEqual(socket.Status.closed, slab.send(2, 7, .text, "late"));
    try std.testing.expectEqual(socket.Status.closed, slab.close(2, 7, 1000, ""));
    try std.testing.expectEqual(@as(?socket.State, .closed), slab.state_of(2));
}

test "a stale generation is rejected on every operation" {
    var slab = Slab{};
    slab.open(0, 4);

    try std.testing.expectEqual(socket.Status.invalid_handle, slab.send(0, 3, .text, "old"));
    try std.testing.expectEqual(socket.Status.invalid_handle, slab.close(0, 3, 1000, ""));
    try std.testing.expectEqual(socket.Status.invalid_handle, slab.pause_dispatch(0, 3));
    try std.testing.expectEqual(socket.Status.invalid_handle, slab.resume_dispatch(0, 3));
    try std.testing.expectEqual(@as(usize, 0), slab.ring.pending());
    try std.testing.expectEqual(@as(u32, 0), slab.buffered(0, 4));
}

test "a recycled slot reports no buffered amount to the old generation" {
    var slab = Slab{};
    slab.open(0, 1);
    _ = slab.send(0, 1, .binary, "abcd");
    try std.testing.expectEqual(@as(u32, 4), slab.buffered(0, 1));

    slab.open(0, 2);
    _ = slab.send(0, 2, .binary, "xy");
    try std.testing.expectEqual(@as(u32, 0), slab.buffered(0, 1));
    try std.testing.expectEqual(@as(u32, 2), slab.buffered(0, 2));
}

test "open resets the record for a recycled generation" {
    var slab = Slab{};
    slab.open(0, 1);
    _ = slab.send(0, 1, .binary, "abcd");
    _ = slab.pause_dispatch(0, 1);
    try std.testing.expect(slab.finish(0));

    slab.open(0, 2);
    try std.testing.expectEqual(@as(?socket.State, .open), slab.state_of(0));
    try std.testing.expectEqual(@as(u32, 0), slab.buffered(0, 2));
    try std.testing.expect(!slab.is_paused(0));
    try std.testing.expect(slab.latch_terminal(0));
}

test "pause and resume dispatch are idempotent while open" {
    var slab = Slab{};
    slab.open(0, 1);

    try std.testing.expectEqual(socket.Status.ok, slab.pause_dispatch(0, 1));
    try std.testing.expectEqual(socket.Status.ok, slab.pause_dispatch(0, 1));
    try std.testing.expect(slab.is_paused(0));
    // ws pauses inbound dispatch only; outbound sends keep working.
    try std.testing.expectEqual(socket.Status.ok, slab.send(0, 1, .text, "while-paused"));
    try std.testing.expectEqual(socket.Status.ok, slab.resume_dispatch(0, 1));
    try std.testing.expectEqual(socket.Status.ok, slab.resume_dispatch(0, 1));
    try std.testing.expect(!slab.is_paused(0));

    try std.testing.expectEqual(socket.Status.ok, slab.close(0, 1, 1000, ""));
    try std.testing.expectEqual(socket.Status.closing, slab.pause_dispatch(0, 1));
    try std.testing.expectEqual(socket.Status.closing, slab.resume_dispatch(0, 1));
}

test "the terminal latch flips exactly once per generation" {
    var slab = Slab{};
    slab.open(0, 5);

    try std.testing.expect(slab.latch_terminal(0));
    try std.testing.expect(!slab.latch_terminal(0));
    try std.testing.expect(!slab.finish(0));

    slab.open(0, 6);
    try std.testing.expect(slab.finish(0));
    try std.testing.expect(!slab.latch_terminal(0));
}

test "concurrent finishers observe a single terminal winner" {
    var slab = Slab{};
    slab.open(0, 1);

    var winners = std.atomic.Value(u32).init(0);
    const Runner = struct {
        fn run(target: *Slab, tally: *std.atomic.Value(u32)) void {
            if (target.finish(0)) _ = tally.fetchAdd(1, .monotonic);
        }
    };

    var threads: [4]std.Thread = undefined;
    for (&threads) |*thread| thread.* = try std.Thread.spawn(.{}, Runner.run, .{ &slab, &winners });
    for (threads) |thread| thread.join();

    try std.testing.expectEqual(@as(u32, 1), winners.load(.acquire));
}

test "draining saturates the buffered amount at zero" {
    var slab = Slab{};
    slab.open(0, 1);

    _ = slab.send(0, 1, .binary, "abcd");
    slab.note_drained(0, 2);
    try std.testing.expectEqual(@as(u32, 2), slab.buffered(0, 1));
    slab.note_drained(0, 9);
    try std.testing.expectEqual(@as(u32, 0), slab.buffered(0, 1));
}

test "valid close codes mirror the compatibility contract" {
    try std.testing.expect(socket.valid_close_code(1000));
    try std.testing.expect(socket.valid_close_code(1014));
    try std.testing.expect(socket.valid_close_code(3000));
    try std.testing.expect(socket.valid_close_code(4999));
    try std.testing.expect(!socket.valid_close_code(1004));
    try std.testing.expect(!socket.valid_close_code(1005));
    try std.testing.expect(!socket.valid_close_code(1006));
    try std.testing.expect(!socket.valid_close_code(1015));
    try std.testing.expect(!socket.valid_close_code(2999));
    try std.testing.expect(!socket.valid_close_code(5000));
}
