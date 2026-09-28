//! Decoder tests. A frame split across reads decodes identically to the same frame in
//! one read, because a peer controls the split, and a frame RFC 6455 forbids is refused
//! with the right close code, because that code is the only thing the peer finds out.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;
const codec_type = support.codec_type;

test "a masked text frame arrives as one text event" {
    var peer = support.server();
    var buffer: [256]u8 = undefined;
    const encoded = (Frame{ .opcode = .text, .payload = "hello", .mask = .{ 0x12, 0x34, 0x56, 0x78 } }).bytes(&buffer);
    try testing.expectEqual(codec.Outcome.ok, peer.feed(encoded).outcome);
    // A further empty read changes nothing, which is the steady state a caller
    // sits in between socket reads.
    try testing.expectEqual(codec.Outcome.ok, peer.feed("").outcome);
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.text, event.kind);
    try testing.expectEqualStrings("hello", event.payload);
    try support.take_none(&peer);
}

test "a masked binary frame arrives as one binary event" {
    const payload = [_]u8{ 0x00, 0xff, 0x7f, 0x80 };
    var peer = support.server();
    var buffer: [256]u8 = undefined;
    const encoded = (Frame{ .opcode = .binary, .payload = &payload, .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
    _ = peer.feed(encoded);
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.binary, event.kind);
    try testing.expectEqualSlices(u8, &payload, event.payload);
}

test "a ping and a pong are delivered with their payload intact" {
    var ping = support.server();
    var buffer: [64]u8 = undefined;
    _ = ping.feed((Frame{ .opcode = .ping, .payload = "beat", .mask = .{ 9, 9, 9, 9 } }).bytes(&buffer));
    const first = try support.take_only(&ping);
    try testing.expectEqual(codec.Kind.ping, first.kind);
    try testing.expectEqualStrings("beat", first.payload);

    var pong = support.server();
    var other: [16]u8 = undefined;
    _ = pong.feed((Frame{ .opcode = .pong, .payload = "", .mask = .{ 9, 9, 9, 9 } }).bytes(&other));
    const second = try support.take_only(&pong);
    try testing.expectEqual(codec.Kind.pong, second.kind);
    try testing.expectEqual(@as(usize, 0), second.payload.len);
}

test "a close frame reports the code and the reason" {
    var payload: [4]u8 = undefined;
    std.mem.writeInt(u16, payload[0..2], 1000, .big);
    payload[2] = 'b';
    payload[3] = 'y';
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .close, .payload = &payload, .mask = .{ 5, 5, 5, 5 } }).bytes(&buffer));
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.close, event.kind);
    try testing.expectEqual(@as(u16, 1000), event.code);
    // The reason is what is left after the code, not the whole payload.
    try testing.expectEqualStrings("by", event.payload);
}

test "a close frame with no code and no reason is valid" {
    var peer = support.server();
    var buffer: [16]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .close, .payload = "", .mask = .{ 5, 5, 5, 5 } }).bytes(&buffer));
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.close, event.kind);
    try testing.expectEqual(@as(u16, 0), event.code);
}

test "an empty message is delivered, not refused" {
    // A frame with no payload never reaches the payload path, so it is the case
    // most likely to lose the opcode that says whether it is text or binary.
    const cases = [_]struct { kind: zslay.Opcode, event: codec.Kind }{
        .{ .kind = .text, .event = .text },
        .{ .kind = .binary, .event = .binary },
    };
    for (cases) |case| {
        var peer = support.server();
        var buffer: [16]u8 = undefined;
        const encoded = (Frame{ .opcode = case.kind, .payload = "", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffer);
        try testing.expectEqual(codec.Outcome.ok, peer.feed(encoded).outcome);
        const event = try support.take_only(&peer);
        try testing.expectEqual(case.event, event.kind);
        try testing.expectEqual(@as(usize, 0), event.payload.len);
    }
}

test "an empty ping and an empty close are both delivered" {
    var peer = support.server();
    var buffers: [2][16]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .ping, .payload = "", .mask = .{ 1, 1, 1, 1 } }).bytes(&buffers[0]));
    _ = peer.feed((Frame{ .opcode = .close, .payload = "", .mask = .{ 2, 2, 2, 2 } }).bytes(&buffers[1]));
    try testing.expectEqual(@as(usize, 2), peer.pending());
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
    peer.take();
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.close, peer.selected_event().?.kind);
    peer.take();
}
