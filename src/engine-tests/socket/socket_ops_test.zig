//! Unit tests for the outbound transitions in `src/engine/socket/socket_ops.zig`.

const std = @import("std");
const payload = @import("../../engine/socket/payload.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);

test "send stages a record and accounts the buffered amount" {
    var slab = Slab{};
    slab.open(1, 42);

    try std.testing.expectEqual(socket.Status.ok, slab.send(1, 42, .text, "hello"));
    try std.testing.expectEqual(@as(u32, 5), slab.buffered(1, 42));

    const view = slab.ring.peek().?;
    try std.testing.expectEqual(@as(u32, 1), view.index);
    try std.testing.expectEqual(@as(u32, 42), view.generation);
    try std.testing.expectEqualStrings("hello", view.bytes);
}

test "the staged copy does not retain caller memory" {
    var slab = Slab{};
    slab.open(0, 1);

    var source = [_]u8{ 1, 2, 3 };
    try std.testing.expectEqual(socket.Status.ok, slab.send(0, 1, .binary, &source));
    source = [_]u8{ 9, 9, 9 };
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, slab.ring.peek().?.bytes);
}

test "send rejects oversized payloads and unknown slots" {
    var slab = Slab{};
    slab.open(0, 1);

    try std.testing.expectEqual(socket.Status.payload_too_large, slab.send(0, 1, .binary, "0123456789abcdefg"));
    try std.testing.expectEqual(socket.Status.invalid_handle, slab.send(4, 1, .binary, "x"));
    try std.testing.expectEqual(@as(u32, 0), slab.buffered(0, 1));
}

test "close validates the code and reason" {
    var slab = Slab{};
    slab.open(0, 1);

    try std.testing.expectEqual(socket.Status.invalid_close_code, slab.close(0, 1, 1005, ""));
    try std.testing.expectEqual(socket.Status.invalid_close_code, slab.close(0, 1, 999, ""));
    try std.testing.expectEqual(socket.Status.invalid_close_reason, slab.close(0, 1, 1000, "x" ** 124));
    try std.testing.expectEqual(socket.Status.invalid_close_reason, slab.close(0, 1, 1000, "\xff\xfe"));
    try std.testing.expectEqual(socket.Status.ok, slab.close(0, 1, 3001, "bye"));
    try std.testing.expectEqual(socket.Status.closing, slab.close(0, 1, 1000, ""));

    const view = slab.ring.peek().?;
    try std.testing.expectEqual(payload.Kind.close, view.kind);
    try std.testing.expectEqualSlices(u8, &.{ 0x0b, 0xb9, 'b', 'y', 'e' }, view.bytes);
}

test "close accepts the exact reason boundary and accounts its bytes" {
    const BigRing = payload.payload_ring(4, 256);
    const BigSlab = socket.socket_slab(4, BigRing, BigRing);
    var slab = BigSlab{};
    slab.open(0, 1);
    const reason = "x" ** 123;

    try std.testing.expectEqual(socket.Status.ok, slab.close(0, 1, 1000, reason));
    try std.testing.expectEqual(@as(u32, 125), slab.buffered(0, 1));
    try std.testing.expectEqual(@as(usize, 125), slab.ring.peek().?.bytes.len);
}

test "close reports backpressure instead of staging into a full ring" {
    var slab = Slab{};
    slab.open(0, 1);
    for (0..4) |_| {
        try std.testing.expectEqual(socket.Status.ok, slab.send(0, 1, .text, "x"));
    }

    try std.testing.expectEqual(socket.Status.backpressure, slab.close(0, 1, 1000, ""));
    try std.testing.expectEqual(@as(?socket.State, .open), slab.state_of(0));
    try std.testing.expectEqual(@as(usize, 4), slab.ring.pending());
}

test "concurrent close stages exactly one frame" {
    var slab = Slab{};
    slab.open(0, 1);

    var ready = std.atomic.Value(bool).init(false);
    const Runner = struct {
        fn run(target: *Slab, gate: *std.atomic.Value(bool)) void {
            while (!gate.load(.acquire)) std.atomic.spinLoopHint();
            _ = target.close(0, 1, 1000, "");
        }
    };

    var threads: [4]std.Thread = undefined;
    for (&threads) |*thread| thread.* = try std.Thread.spawn(.{}, Runner.run, .{ &slab, &ready });
    ready.store(true, .release);
    for (threads) |thread| thread.join();

    try std.testing.expectEqual(@as(usize, 1), slab.ring.pending());
    try std.testing.expectEqual(@as(?socket.State, .closing), slab.state_of(0));
}
