//! Tests for the frames RFC 6455 forbids, and the close code each one maps to.
//!
//! The close code is the only thing a peer ever finds out, so getting it wrong is
//! a protocol failure even when everything else works. The distinction these tests
//! exist to hold is 1009 against 1002: a payload over the cap is a size limit and
//! invalid UTF-8 is an invalid payload, and neither is a framing violation.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;
const raw_frame = support.raw_frame;

test "an unmasked frame from a peer is a protocol error" {
    // Section 5.1: a server must close on an unmasked frame.
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "no mask" }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "a client refuses a masked frame" {
    var peer = support.client();
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "masked", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "a reserved bit without a negotiated extension is a protocol error" {
    // Section 5.2. RSV1 carries the compressed flag and only exists once an
    // extension is negotiated, which the codec does not do, so a peer that sets
    // it is claiming an extension nobody agreed to.
    for ([_]u8{ 0x40, 0x20, 0x10 }) |reserved_bit| {
        var buffer: [16]u8 = undefined;
        const encoded = raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.text), 1, true, .{ 1, 2, 3, 4 }, "x");
        buffer[0] |= reserved_bit;
        var peer = support.server();
        _ = peer.feed(encoded);
        try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
        try testing.expectEqual(@as(u16, 1002), peer.failure_code());
    }
}

test "a message over the cap is 1009, not 1002" {
    // A size limit reported as a protocol error tells the peer the wrong thing
    // about why its connection died, which is what a conformance suite checks.
    const Small = codec.codec(16, 4);
    var peer = Small.init(.server);
    var buffer: [64]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "0123456789abcdefghij", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded).outcome);
    try testing.expectEqual(codec.Failure.message_too_large, peer.pending_failure().?);
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

test "a continuation with no message in progress is a protocol error" {
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .continuation, .payload = "orphan", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer));
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
}

test "a new data frame while a message is in progress is a protocol error" {
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const parts = [_]Frame{
        .{ .fin = false, .opcode = .text, .payload = "open", .mask = .{ 1, 1, 1, 1 } },
        .{ .fin = true, .opcode = .text, .payload = "again", .mask = .{ 2, 2, 2, 2 } },
    };
    for (parts) |part| _ = peer.feed(part.bytes(&buffer));
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
}

test "a fragmented control frame is a protocol error" {
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, false, @intFromEnum(zslay.Opcode.ping), 1, true, .{ 1, 2, 3, 4 }, "x"));
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
}

test "a control frame over 125 bytes is a protocol error" {
    // Section 5.5. 126 bytes needs the two-byte extended length, so this also
    // covers the length encoding rather than only the cap.
    var peer = support.server();
    var buffer: [256]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.ping), 126, true, .{ 1, 2, 3, 4 }, "x" ** 126));
    try testing.expectEqual(codec.Failure.protocol_error, peer.pending_failure().?);
}
