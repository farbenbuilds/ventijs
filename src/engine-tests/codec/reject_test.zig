//! Tests for the frames RFC 6455 forbids, and the failure each one is reported as.
//!
//! Both halves are load bearing. The close code is the only thing a peer finds out, and the
//! failure ordinal is what lets a caller tell a misbehaving peer from a bug of its own:
//! `ws` gives every one of these a distinct `WS_ERR_*` string.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const limits = @import("../../engine/codec/limits.zig");
const support = @import("frame_support.zig");

/// A trusted limits record for a suite that wants its own ceilings.
fn trusted(max_message: usize, max_fragments: usize) limits.Limits {
    return limits.Limits.trust(max_message, max_fragments, true, false) catch unreachable;
}

const Frame = support.Frame;
const raw_frame = support.raw_frame;

test "an unmasked frame from a peer is an expected mask" {
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "no mask" }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(codec.Failure.expected_mask, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "a client refuses a masked frame" {
    var peer = support.client();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "masked", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(codec.Failure.unexpected_mask, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "each reserved bit is named, not folded into a protocol error" {
    // Section 5.2: RSV1 only means anything once an extension defines it, and RSV2 and RSV3
    // never do. All three close with 1002, and none is the same fault as the one next to it,
    // which is what `ws`'s three separate codes say.
    const cases = [_]struct { bit: u8, failure: codec.Failure }{
        .{ .bit = 0x40, .failure = .unexpected_rsv_1 },
        .{ .bit = 0x20, .failure = .unexpected_rsv_2_3 },
        .{ .bit = 0x10, .failure = .unexpected_rsv_2_3 },
    };
    for (cases) |case| {
        var buffer: [16]u8 = undefined;
        const encoded = raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.text), 1, true, .{ 1, 2, 3, 4 }, "x");
        buffer[0] |= case.bit;
        var peer = support.server();
        defer peer.deinit();
        _ = peer.feed(encoded);
        try testing.expectEqual(case.failure, peer.pending_failure().?);
        try testing.expectEqual(@as(u16, 1002), peer.failure_code());
    }
}

test "a message over the cap is 1009, not 1002" {
    const Small = codec.codec(4);
    var peer = Small.init(.server, trusted(16, 8)) catch unreachable;
    defer peer.deinit();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "0123456789abcdefghij", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(codec.Failure.unsupported_message_length, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1009), peer.failure_code());
}

test "invalid UTF-8 in a text message is 1007" {
    const cases = [_][]const u8{
        "\xc3", // truncated
        "\xed\xa0\x80", // a surrogate half
        "\xc0\x80", // overlong
        "\xf4\x90\x80\x80", // past U+10FFFF
        "\xff", // never a lead byte
    };
    for (cases) |payload| {
        var peer = support.server();
        var buffer: [64]u8 = undefined;
        const encoded = (Frame{ .opcode = .text, .payload = payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
        _ = peer.feed(encoded);
        try testing.expectEqual(codec.Failure.invalid_utf8, peer.pending_failure().?);
        try testing.expectEqual(@as(u16, 1007), peer.failure_code());
    }
}

test "binary messages are not UTF-8 validated" {
    const payload = [_]u8{ 0xff, 0xfe, 0x00, 0xc3 };
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .binary, .payload = &payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.ok, peer.feed(encoded).outcome);
    try testing.expectEqualSlices(u8, &payload, (try support.take_only(&peer)).payload);
}

test "a continuation with no message in progress is an invalid opcode" {
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .continuation, .payload = "orphan", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
    try testing.expectEqual(codec.Failure.invalid_opcode, peer.pending_failure().?);
}

test "a new data frame while a message is in progress is an invalid opcode" {
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const parts = [_]Frame{
        .{ .fin = false, .opcode = .text, .payload = "open", .mask = .{ 1, 1, 1, 1 } },
        .{ .fin = true, .opcode = .text, .payload = "again", .mask = .{ 2, 2, 2, 2 } },
    };
    for (parts) |part| _ = peer.feed(part.bytes(&buffer));
    try testing.expectEqual(codec.Failure.invalid_opcode, peer.pending_failure().?);
}

test "a fragmented control frame is an expected fin" {
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, false, @intFromEnum(zslay.Opcode.ping), 1, true, .{ 1, 2, 3, 4 }, "x"));
    try testing.expectEqual(codec.Failure.expected_fin, peer.pending_failure().?);
}

test "a control frame over 125 bytes is an invalid control payload length" {
    // Section 5.5. 126 bytes needs the two-byte extended length, so this covers the length
    // encoding too, not only the cap.
    var peer = support.server();
    var buffer: [256]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.ping), 126, true, .{ 1, 2, 3, 4 }, "x" ** 126));
    try testing.expectEqual(codec.Failure.invalid_control_payload_length, peer.pending_failure().?);
}
