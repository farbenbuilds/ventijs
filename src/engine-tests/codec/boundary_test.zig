//! Read-boundary tests for the frame codec.
//!
//! A peer chooses how much arrives per read, and it chooses adversarially: a
//! frame can be split anywhere, including inside its header, inside its masking
//! key, and inside a multi-byte UTF-8 sequence. These tests put the same bytes
//! through every split and require one answer, because "it worked in testing" on
//! a frame that happened to arrive whole is not a property of the codec.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;

test "a message split across reads decodes identically to the same frame whole" {
    const text = "the quick brown fox";
    const mask = [4]u8{ 0xaa, 0xbb, 0xcc, 0xdd };

    var reference_buffer: [256]u8 = undefined;
    const reference_frame = (Frame{ .opcode = .text, .payload = text, .mask = mask }).bytes(&reference_buffer);
    var reference = support.server();
    try testing.expectEqual(codec.Outcome.ok, reference.feed(reference_frame).outcome);
    const expected = (try support.take_only(&reference)).payload;

    // A fresh frame per split, because `feed` unmasks in place and a masked frame
    // is only valid masked: re-feeding the same buffer would be feeding plaintext
    // through a decoder that expects ciphertext.
    var split: usize = 1;
    while (split < reference_frame.len) : (split += 1) {
        var buffer: [256]u8 = undefined;
        const encoded = (Frame{ .opcode = .text, .payload = text, .mask = mask }).bytes(&buffer);
        var peer = support.server();
        const first = peer.feed(encoded[0..split]);
        try testing.expectEqual(codec.Outcome.ok, first.outcome);
        try testing.expectEqual(split, first.consumed);
        const second = peer.feed(encoded[split..]);
        try testing.expectEqual(codec.Outcome.ok, second.outcome);
        try testing.expectEqual(encoded.len - split, second.consumed);
        const event = try support.take_only(&peer);
        try testing.expectEqualStrings(expected, event.payload);
    }
}

test "feeding a frame one byte at a time produces the same event" {
    var buffer: [256]u8 = undefined;
    const encoded = (Frame{ .opcode = .binary, .payload = "abcdefgh", .mask = .{ 3, 1, 4, 1 } }).bytes(&buffer);
    var peer = support.server();
    for (encoded) |byte| {
        _ = peer.feed(&.{byte});
        if (peer.pending() != 0) break;
    }
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.binary, event.kind);
    try testing.expectEqualStrings("abcdefgh", event.payload);
}

test "a multi-byte sequence split across fragments is valid" {
    // The reason the UTF-8 state has to be carried across frames: a validator
    // that checked each frame on its own would reject this message.
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const parts = [_]Frame{
        .{ .fin = false, .opcode = .text, .payload = "\xe2\x82", .mask = .{ 1, 1, 1, 1 } },
        .{ .fin = true, .opcode = .continuation, .payload = "\xac", .mask = .{ 2, 2, 2, 2 } },
    };
    for (parts) |part| {
        _ = peer.feed(part.bytes(&buffer));
        try testing.expect(peer.pending_failure() == null);
    }
    try testing.expectEqualStrings("\xe2\x82\xac", (try support.take_only(&peer)).payload);
}
