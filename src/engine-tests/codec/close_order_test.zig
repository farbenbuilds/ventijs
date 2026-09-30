//! Delivery order around a close. The control ring keeps FIFO order, and a data message
//! completed after a close is dropped: `ws` stops parsing at a close, so only messages
//! queued before it may be delivered first (RFC 6455 section 5.5.1).

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Peer = codec.codec(8);

/// A masked client frame, because a server-role codec refuses an unmasked one.
fn masked(out: []u8, fin: bool, opcode: u8, payload: []const u8) []const u8 {
    return support.raw_frame(out, fin, opcode, @intCast(payload.len), true, .{ 0x37, 0xfa, 0x21, 0x3d }, payload);
}

test "a data message completed after a close is not delivered" {
    var peer = Peer.init(.server, support.trusted()) catch unreachable;
    defer peer.deinit();
    var buffer: [128]u8 = undefined;
    var at: usize = 0;
    const close = masked(buffer[at..], true, 0x8, "\x03\xe8");
    at += close.len;
    const ping = masked(buffer[at..], true, 0x9, "beat");
    at += ping.len;
    const late = masked(buffer[at..], true, 0x1, "late");
    at += late.len;
    _ = peer.feed(buffer[0..at]);

    // The close stays the first control event, the ping keeps its place behind it, and
    // the text frame the peer sent after the close never becomes an event at all.
    try testing.expect(peer.select());
    const first = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.close, first.kind);
    try testing.expectEqual(@as(u16, 1000), first.code);

    try testing.expect(peer.select());
    const second = peer.selected_event().?;
    peer.take();
    try testing.expectEqual(codec.Kind.ping, second.kind);
    try testing.expectEqualStrings("beat", second.payload);

    try support.take_none(&peer);
}
