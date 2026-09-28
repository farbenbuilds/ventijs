//! Encoder tests for the frame codec.
//!
//! The encoder's first job is to obey the masking discipline, because that is the
//! part a peer can be attacked through: a server must not mask, and a client must
//! mask with a fresh unpredictable key on every frame. The second is that the
//! formatted bytes and the decoder agree, which is what the round trip pins.

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const limits = @import("../../engine/codec/limits.zig");
const support = @import("frame_support.zig");

/// A trusted limits record for a suite that wants its own ceilings.
fn trusted(max_message: usize, max_fragments: usize) limits.Limits {
    return limits.Limits.trust(max_message, max_fragments, true, false) catch unreachable;
}

test "the encoder produces an unmasked frame for a server" {
    var peer = support.server();
    const frame = support.framed(&peer, .text, true, "hello");
    try testing.expectEqual(@as(usize, 7), frame.result.ok);
    try testing.expect(!frame.masked);
    // FIN plus the text opcode, and no mask bit.
    try testing.expectEqual(@as(u8, 0x81), frame.bytes[0]);
    try testing.expectEqual(@as(u8, 0x00), frame.bytes[1] & 0x80);
}

test "the encoder produces a masked frame for a client" {
    var peer = support.client();
    // Two header bytes, a four-byte key, and five payload bytes.
    const frame = support.framed(&peer, .text, true, "hello");
    try testing.expectEqual(@as(usize, 11), frame.result.ok);
    try testing.expect(frame.masked);
    try testing.expectEqual(@as(u8, 0x81), frame.bytes[0]);
    try testing.expectEqual(@as(u8, 0x80), frame.bytes[1] & 0x80);
}

test "a client draws a different masking key for every frame" {
    // Section 5.3 requires a fresh unpredictable key per frame. Two identical
    // frames on one connection must not come out byte-identical, or the mask is
    // doing nothing for anyone.
    var peer = support.client();
    const first = support.framed(&peer, .text, true, "same");
    // Copied because the transmit state holds one frame at a time: `first.bytes` and
    // `second.bytes` are views of the same buffer, so comparing them without a copy
    // compares the second frame with itself and passes whatever the key does.
    var first_bytes: [64]u8 = undefined;
    @memcpy(first_bytes[0..first.result.ok], first.bytes[0..first.result.ok]);

    const second = support.framed(&peer, .text, true, "same");
    try testing.expectEqual(first.result.ok, second.result.ok);
    try testing.expect(!std.mem.eql(u8, first_bytes[0..first.result.ok], second.bytes[0..second.result.ok]));
}

test "every encoded control frame is a legal 125-byte frame" {
    var peer = support.client();
    // Two header bytes, a four-byte key, and no payload.
    try testing.expectEqual(@as(usize, 6), support.framed(&peer, .ping, true, "").result.ok);
    try testing.expectEqual(@as(usize, 131), support.framed(&peer, .pong, true, "x" ** 125).result.ok);
    try testing.expectEqual(codec.Failure.invalid_control_payload_length, support.framed(&peer, .ping, true, "x" ** 126).result.failed);
    try testing.expectEqual(codec.Failure.expected_fin, support.framed(&peer, .close, false, "").result.failed);
}

test "a caller's own mask is the key that goes on the wire" {
    // `ws`'s `generateMask`, and the reason it has to be four bytes rather than "some
    // bytes": the key is the mask, and a shorter one would produce a frame a peer
    // unmasks into the wrong plaintext.
    var peer = support.client();
    const wanted = [4]u8{ 0xde, 0xad, 0xbe, 0xef };
    const length = peer.tx.encode(.text, true, "hello", false, &wanted).ok;
    const frame = peer.tx.bytes();
    // Two header bytes, then the key, then the masked payload.
    try testing.expectEqualSlices(u8, &wanted, frame[2..6]);

    // And the frame it produces is the frame that key describes: the payload unmasks
    // back to the bytes that went in, which is what a peer will do with it.
    var plain: [4]u8 = undefined;
    for (0..4) |index| plain[index] = frame[6 + index] ^ wanted[index];
    try testing.expectEqualSlices(u8, "hell", &plain);
    try testing.expectEqual(@as(usize, 11), length);
}

test "a mask that is not four bytes is refused before anything is framed" {
    var peer = support.client();
    try testing.expectEqual(
        codec.Failure.invalid_mask,
        peer.tx.encode(.text, true, "hello", false, "abc").failed,
    );
}

test "the encoder refuses a payload over the cap" {
    const Small = codec.codec(2);
    var peer = Small.init(.server, trusted(8, 8)) catch unreachable;
    defer peer.deinit();
    try testing.expectEqual(codec.Failure.unsupported_message_length, peer.tx.encode(.text, true, "123456789", false, &.{}).failed);
    try testing.expectEqual(@as(usize, 10), peer.tx.encode(.text, true, "12345678", false, &.{}).ok);
}

test "a round trip through the encoder and the decoder preserves the message" {
    // The two halves have to agree even though the decoder was written against
    // the RFC and the encoder against `zslay`.
    const messages = [_][]const u8{ "", "a", "hello", "x" ** 200, "\xe2\x82\xac per byte" };
    for (messages) |message| {
        var encoder = support.client();
        var decoder = support.server();
        const frame = support.framed(&encoder, .text, true, message);
        try testing.expectEqual(codec.Outcome.ok, decoder.feed(frame.bytes[0..frame.result.ok]).outcome);
        const event = try support.take_only(&decoder);
        try testing.expectEqual(codec.Kind.text, event.kind);
        try testing.expectEqualStrings(message, event.payload);
    }
}

test "an encoded close frame carries the code and reason the decoder reads back" {
    // Both halves on one frame: the encoder lays out the two code bytes and the
    // reason, and the decoder has to split them back the way `ws` reports them.
    var payload: [4]u8 = undefined;
    std.mem.writeInt(u16, payload[0..2], 1011, .big);
    payload[2] = 'o';
    payload[3] = 'k';

    var encoder = support.client();
    const frame = support.framed(&encoder, .close, true, &payload);
    try testing.expectEqual(@as(usize, 10), frame.result.ok);

    var decoder = support.server();
    try testing.expectEqual(codec.Outcome.ok, decoder.feed(frame.bytes).outcome);
    const event = try support.take_only(&decoder);
    try testing.expectEqual(codec.Kind.close, event.kind);
    try testing.expectEqual(@as(u16, 1011), event.code);
    // The reason is what is left after the code, not the whole payload: a caller
    // that got the code twice would have to know to strip it.
    try testing.expectEqualStrings("ok", event.payload);
}
