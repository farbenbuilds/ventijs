//! The faults a close payload and a declared length can have: the two the parser accepts
//! the header for and then rejects, so the deciding code is not in the two base octets.
//! A reserved close code must not read as a generic protocol error, which would make an
//! ordinary proxy fault look like a misbehaving client.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const raw_frame = support.raw_frame;

test "a reserved opcode is an invalid opcode" {
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, true, 0x3, 1, true, .{ 1, 2, 3, 4 }, "x"));
    try testing.expectEqual(codec.Failure.invalid_opcode, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "a declared length past 2^53 is an unsupported length rather than a size limit" {
    // `ws` reads the high 32 bits of the 64-bit length and refuses above 2^21, because
    // no JavaScript number could describe a larger frame. 1009 is the size limit code,
    // which is what `ws` uses here and not the protocol error a malformed frame gets.
    var peer = support.server();
    var frame: [14]u8 = .{ 0x82, 0xff, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 1, 2, 3, 4 };
    _ = peer.feed(&frame);
    try testing.expectEqual(codec.Failure.unsupported_data_payload_length, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1009), peer.failure_code());
}

test "a close payload with a reserved code is an invalid close code" {
    // 1005 and 1006 are codes this side of the wire invents for itself, so a peer
    // cannot send them, and neither can 1016 or 2999.
    const cases = [_]u16{ 0, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535 };
    for (cases) |code| {
        var peer = support.server();
        var buffer: [16]u8 = undefined;
        var payload: [2]u8 = undefined;
        std.mem.writeInt(u16, &payload, code, .big);
        _ = peer.feed(raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.close), payload.len, true, .{ 1, 2, 3, 4 }, &payload));
        try testing.expectEqual(codec.Failure.invalid_close_code, peer.pending_failure().?);
        try testing.expectEqual(@as(u16, 1002), peer.failure_code());
    }
}

test "a close payload one byte long is an invalid control payload length" {
    // The length is wrong before the code is readable, and `ws` names both faults in
    // the same `createError` call, so the length is the one reported here.
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    _ = peer.feed(raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.close), 1, true, .{ 1, 2, 3, 4 }, "\x03"));
    try testing.expectEqual(codec.Failure.invalid_control_payload_length, peer.pending_failure().?);
}

test "a close reason that is not UTF-8 is 1007" {
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    var payload: [4]u8 = .{ 0x03, 0xe8, 0xff, 0xfe };
    _ = peer.feed(raw_frame(&buffer, true, @intFromEnum(zslay.Opcode.close), payload.len, true, .{ 1, 2, 3, 4 }, &payload));
    try testing.expectEqual(codec.Failure.invalid_utf8, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1007), peer.failure_code());
}

test "a base header split across two reads is refused the same way" {
    // The two-octet decision is made from the codec's own copy, so a peer that sends one
    // octet at a time gets the same answer as one that sends both.
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    const encoded = raw_frame(&buffer, false, @intFromEnum(zslay.Opcode.ping), 1, true, .{ 1, 2, 3, 4 }, "x");
    try testing.expectEqual(codec.Outcome.ok, peer.feed(encoded[0..1]).outcome);
    try testing.expectEqual(codec.Outcome.failed, peer.feed(encoded[1..2]).outcome);
    try testing.expectEqual(codec.Failure.expected_fin, peer.pending_failure().?);
}
