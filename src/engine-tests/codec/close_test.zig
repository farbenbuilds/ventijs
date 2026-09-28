//! Close-frame tests for the frame codec.
//!
//! The close frame is where the codec's two outputs meet: a code and a reason, and the
//! close code a refused frame maps to. A caller reports both, and the two ways a close can
//! be wrong -- a code the RFC reserves, and a reason that is not valid UTF-8 -- map to
//! different codes.

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;

test "a close frame with a reserved code is an invalid close code" {
    // Section 7.4: 1005, 1006, and 1015 must not appear on the wire.
    for ([_]u16{ 1005, 1006, 1015 }) |reserved| {
        var payload: [2]u8 = undefined;
        std.mem.writeInt(u16, payload[0..2], reserved, .big);
        var peer = support.server();
        var buffer: [64]u8 = undefined;
        _ = peer.feed((Frame{ .opcode = .close, .payload = &payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
        try testing.expectEqual(codec.Failure.invalid_close_code, peer.pending_failure().?);
        try testing.expectEqual(@as(u16, 1002), peer.failure_code());
    }
}

test "a close frame with invalid UTF-8 in the reason is 1007" {
    const payload = [_]u8{ 0x03, 0xe8, 0xff };
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .close, .payload = &payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
    try testing.expectEqual(codec.Failure.invalid_utf8, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1007), peer.failure_code());
}

test "a one-byte close payload is a protocol error" {
    const payload = [_]u8{0x03};
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .close, .payload = &payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
}

test "a failure is latched so every later call reports the same reason" {
    // Reporting a different reason on the second call would be a lie.
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .text, .payload = "\xff", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
    const latched = peer.pending_failure();
    _ = peer.feed("more bytes");
    try testing.expectEqual(latched, peer.pending_failure());
    try testing.expectEqual(codec.Outcome.failed, peer.feed("").outcome);
}
