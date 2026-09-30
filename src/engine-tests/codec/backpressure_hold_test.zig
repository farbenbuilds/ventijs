//! Header-only frames under a full store. A zero-payload frame never reaches the payload
//! copy where room is first checked, so without a check before the frame completes the
//! parser consumes the bytes and the finished event, a pong or an empty message, is lost.

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;

test "a pong with no payload waits for the control ring" {
    // RFC 6455 section 5.5.2 requires answering a ping promptly; a dropped pong reported
    // as backpressure is a lost answer.
    const One = codec.codec(1);
    var peer = One.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
    var buffers: [2][32]u8 = undefined;
    const ping = (Frame{ .opcode = .ping, .payload = "", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffers[0]);
    const pong = (Frame{ .opcode = .pong, .payload = "", .mask = .{ 5, 6, 7, 8 } }).bytes(&buffers[1]);

    try testing.expectEqual(codec.Outcome.ok, peer.feed(ping).outcome);
    const blocked = peer.feed(pong);
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);
    // Everything was consumed, and the frame itself is held by the parser.
    try testing.expectEqual(pong.len, blocked.consumed);
    try testing.expectEqual(@as(usize, 1), peer.pending());

    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
    peer.take();

    // The held header is the whole frame, so the remainder to re-feed is empty.
    try testing.expectEqual(codec.Outcome.ok, peer.feed(pong[blocked.consumed..]).outcome);
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.pong, peer.selected_event().?.kind);
    peer.take();
    try testing.expectEqual(@as(usize, 0), peer.pending());
    try testing.expect(!peer.select());
}

test "a ninth empty ping is held, not lost, when the ring is full" {
    var peer = support.server();
    var scratch: [9][32]u8 = undefined;
    var joined: [512]u8 = undefined;
    var written: usize = 0;
    for (0..9) |index| {
        const frame = (Frame{
            .opcode = .ping,
            .payload = "",
            .mask = .{ @intCast(index + 1), 2, 3, 4 },
        }).bytes(&scratch[index]);
        @memcpy(joined[written..][0..frame.len], frame);
        written += frame.len;
    }
    const all = joined[0..written];
    const blocked = peer.feed(all);
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);
    try testing.expectEqual(@as(usize, 8), peer.pending());
    for (0..8) |_| {
        try testing.expect(peer.select());
        try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
        peer.take();
    }
    try testing.expectEqual(codec.Outcome.ok, peer.feed(all[blocked.consumed..]).outcome);
    try testing.expectEqual(@as(usize, 1), peer.pending());
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
    peer.take();
    try support.take_none(&peer);
}

test "an empty text message waits for the message slot" {
    var peer = support.server();
    var buffers: [2][32]u8 = undefined;
    const first = (Frame{ .opcode = .text, .payload = "", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffers[0]);
    const second = (Frame{ .opcode = .text, .payload = "", .mask = .{ 5, 6, 7, 8 } }).bytes(&buffers[1]);

    try testing.expectEqual(codec.Outcome.ok, peer.feed(first).outcome);
    const blocked = peer.feed(second);
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);
    try testing.expectEqual(second.len, blocked.consumed);

    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.text, peer.selected_event().?.kind);
    try testing.expectEqualStrings("", peer.selected_event().?.payload);
    peer.take();

    try testing.expectEqual(codec.Outcome.ok, peer.feed(second[blocked.consumed..]).outcome);
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.text, peer.selected_event().?.kind);
    try testing.expectEqualStrings("", peer.selected_event().?.payload);
    peer.take();
    try support.take_none(&peer);
}
