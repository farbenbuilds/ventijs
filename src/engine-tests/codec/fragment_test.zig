//! Fragmentation tests. RFC 6455 5.4 makes a message a sequence of frames and 5.5 permits
//! control frames interleaved between them. A codec that reassembles eagerly delivers a
//! partial message; one that tracks the opcode per chunk loses it.

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;

test "a fragmented text message is delivered once, on the final fragment" {
    // RFC 6455 section 5.4: the fragments are one message and the opcode that
    // matters is the first one's.
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const parts = [_]Frame{
        .{ .fin = false, .opcode = .text, .payload = "frag1", .mask = .{ 1, 1, 1, 1 } },
        .{ .fin = false, .opcode = .continuation, .payload = "frag2", .mask = .{ 2, 2, 2, 2 } },
        .{ .fin = true, .opcode = .continuation, .payload = "frag3", .mask = .{ 3, 3, 3, 3 } },
    };
    for (parts) |part| {
        try testing.expectEqual(codec.Outcome.ok, peer.feed(part.bytes(&buffer)).outcome);
    }
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.text, event.kind);
    try testing.expectEqualStrings("frag1frag2frag3", event.payload);
}

test "a control frame may be interleaved between fragments" {
    // Section 5.5 allows this and requires that it not disturb the message.
    var peer = support.server();
    var buffer: [64]u8 = undefined;
    const parts = [_]Frame{
        .{ .fin = false, .opcode = .text, .payload = "one", .mask = .{ 1, 1, 1, 1 } },
        .{ .opcode = .ping, .payload = "mid", .mask = .{ 2, 2, 2, 2 } },
        .{ .fin = true, .opcode = .continuation, .payload = "two", .mask = .{ 3, 3, 3, 3 } },
    };
    for (parts) |part| {
        try testing.expectEqual(codec.Outcome.ok, peer.feed(part.bytes(&buffer)).outcome);
    }

    try testing.expectEqual(@as(usize, 2), peer.pending());
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
    peer.take();
    try testing.expect(peer.select());
    const message = peer.selected_event().?;
    try testing.expectEqual(codec.Kind.text, message.kind);
    try testing.expectEqualStrings("onetwo", message.payload);
}
