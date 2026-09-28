//! Fragment boundaries, and a `close` that no longer overtakes a data message: control
//! frames drain ahead so a ping is answered promptly, and `close` rode that rule into
//! the terminal case, so a peer writing a message and a close in one read lost the first.

const std = @import("std");
const testing = std.testing;

const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");
const frames = @import("frame_support.zig");

const Peer = codec.codec(8);

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
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
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

    // Three pieces means two cuts: the last piece runs to the end of the buffer and the
    // caller already has that length, so an interior-only list slices into three.
    const ends = peer.fragment_ends();
    try testing.expectEqual(@as(usize, 2), ends.len);
    try testing.expectEqual(@as(u32, 3), ends[0]);
    try testing.expectEqual(@as(u32, 5), ends[1]);
}

test "a whole message has no interior boundary" {
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
    var buffer: [64]u8 = undefined;
    const written = masked(buffer[0..], true, 0x2, "whole");
    _ = peer.feed(written);
    // One piece and no interior boundary, so the facade reports no list rather than a
    // list of one.
    try testing.expectEqual(@as(usize, 0), peer.fragment_ends().len);
}

test "a second message does not inherit the first one's boundaries" {
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
    var first: [128]u8 = undefined;
    var at: usize = 0;
    const a = masked(first[at..], false, 0x2, "aa");
    at += a.len;
    const b = masked(first[at..], true, 0x0, "bb");
    at += b.len;
    _ = peer.feed(first[0..at]);
    try testing.expectEqual(@as(usize, 1), peer.fragment_ends().len);
    _ = try frames.take_only(&peer);

    // The accumulator resets on the second message's first byte, so it cannot inherit
    // the first one's boundaries.
    var second: [64]u8 = undefined;
    const c = masked(second[0..], true, 0x2, "cccc");
    _ = peer.feed(c);
    try testing.expectEqual(@as(usize, 0), peer.fragment_ends().len);
    const event = try frames.take_only(&peer);
    try testing.expectEqualStrings("cccc", event.payload);
}

test "a close does not overtake a message already queued" {
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
    var buffer: [128]u8 = undefined;
    var at: usize = 0;
    const message = masked(buffer[at..], true, 0x1, "last");
    at += message.len;
    // A masked close with code 1000. A control frame is never fragmented, and a
    // continuation after a finished message is an orphan the RFC refuses.
    const close = masked(buffer[at..], true, 0x8, "\x03\xe8");
    at += close.len;
    _ = peer.feed(buffer[0..at]);

    // The drain has to reach the message first: `close` is terminal, and dispatching it
    // ends the socket.
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
    // Only `close` is excepted from the priority, because only `close` ends the socket;
    // an unanswered ping has a deadline in RFC 6455 5.5.2.
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
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
