//! The two properties the codec gained, and the one it lost and got back.
//!
//! **Fragment boundaries.** A message split into pieces now records where each piece
//! ended, which is what `binaryType: "fragments"` slices on and what the `maxFragments`
//! bound counts. The list belongs to one message, so the case that matters is that a
//! second message does not inherit the first one's boundaries.
//!
//! **Close never overtakes a data message.** Control frames drain ahead of messages so
//! a ping is answered promptly, and `close` rode that rule into the terminal case:
//! dispatching it ended the socket and dropped a message the peer had sent first. A
//! peer that writes a message and a close in one read is how every application says
//! goodbye, so this was the commonest goodbye in the protocol losing its last message.

const std = @import("std");
const testing = std.testing;

const codec = @import("../../engine/codec/state.zig");
const frames = @import("frame_support.zig");

const Peer = codec.codec(4096, 8, 64);

/// One piece of a split message.
const Piece = struct {
    fin: bool,
    opcode: u8,
    payload: []const u8,
};

/// A masked client frame, because a server-role codec refuses an unmasked one.
fn masked(out: []u8, fin: bool, opcode: u8, payload: []const u8) []const u8 {
    return frames.raw_frame(out, fin, opcode, @intCast(payload.len), true, .{ 0x37, 0xfa, 0x21, 0x3d }, payload);
}

test "a split message records one boundary per piece" {
    var peer = Peer.init(.server, true);
    var buffer: [256]u8 = undefined;
    var at: usize = 0;
    const pieces = [_]Piece{
        .{ .fin = false, .opcode = 0x2, .payload = "aaa" },
        .{ .fin = false, .opcode = 0x0, .payload = "bb" },
        .{ .fin = true, .opcode = 0x0, .payload = "c" },
    };
    for (pieces) |part| {
        const written = masked(buffer[at..], part.fin, part.opcode, part.payload);
        at += written.len;
    }
    _ = peer.feed(buffer[0..at]);

    // Three pieces means two cuts, and the list holds the cuts rather than the pieces:
    // the last piece runs to the end of the buffer and the caller already has that
    // length. An interior-only list is what makes slicing it produce three pieces and
    // not three plus an empty fourth.
    const ends = peer.fragment_ends();
    try testing.expectEqual(@as(usize, 2), ends.len);
    try testing.expectEqual(@as(u32, 3), ends[0]);
    try testing.expectEqual(@as(u32, 5), ends[1]);
}

test "a whole message has no interior boundary" {
    var peer = Peer.init(.server, true);
    var buffer: [64]u8 = undefined;
    const written = masked(buffer[0..], true, 0x2, "whole");
    _ = peer.feed(written);
    // One piece and no interior boundary, so the facade reports no list at all rather
    // than a list of one.
    try testing.expectEqual(@as(usize, 0), peer.fragment_ends().len);
}

test "a second message does not inherit the first one's boundaries" {
    var peer = Peer.init(.server, true);
    var first: [128]u8 = undefined;
    var at: usize = 0;
    const a = masked(first[at..], false, 0x2, "aa");
    at += a.len;
    const b = masked(first[at..], true, 0x0, "bb");
    at += b.len;
    _ = peer.feed(first[0..at]);
    try testing.expectEqual(@as(usize, 1), peer.fragment_ends().len);
    _ = try frames.take_only(&peer);

    // A whole second message: the accumulator is reset on its first byte, so the
    // previous message's boundaries cannot be reported against it.
    var second: [64]u8 = undefined;
    const c = masked(second[0..], true, 0x2, "cccc");
    _ = peer.feed(c);
    try testing.expectEqual(@as(usize, 0), peer.fragment_ends().len);
    const event = try frames.take_only(&peer);
    try testing.expectEqualStrings("cccc", event.payload);
}

test "a close does not overtake a message already queued" {
    var peer = Peer.init(.server, true);
    var buffer: [128]u8 = undefined;
    var at: usize = 0;
    const message = masked(buffer[at..], true, 0x1, "last");
    at += message.len;
    // A masked close with code 1000. No fin parameter: a control frame is never
    // fragmented, and a continuation after a finished message is an orphan the RFC
    // refuses.
    const close = masked(buffer[at..], true, 0x8, "\x03\xe8");
    at += close.len;
    _ = peer.feed(buffer[0..at]);

    // Both are waiting, and the drain has to reach the message first: the close is
    // terminal, and dispatching it ends the socket.
    try testing.expect(peer.select());
    const first = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.text, first.kind);
    try testing.expectEqualStrings("last", first.payload);

    try testing.expect(peer.select());
    const second = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.close, second.kind);
    try testing.expectEqual(@as(u16, 1000), second.code);
}

test "a ping still overtakes a message" {
    // The rule the priority exists for. Only `close` is excepted, because only
    // `close` ends the socket; a ping the application has not answered has a
    // deadline in RFC 6455 section 5.5.2 and a message ahead of it would delay it.
    var peer = Peer.init(.server, true);
    var buffer: [128]u8 = undefined;
    var at: usize = 0;
    const ping = masked(buffer[at..], true, 0x9, "beat");
    at += ping.len;
    const message = masked(buffer[at..], true, 0x1, "hello");
    at += message.len;
    _ = peer.feed(buffer[0..at]);

    try testing.expect(peer.select());
    const first = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.ping, first.kind);
    try testing.expect(peer.select());
    const second = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.text, second.kind);
}
