//! Backpressure tests for the frame codec.
//!
//! A full event store is not a protocol fault and must never be reported as one.
//! These tests pin where the decoder stops, what survives, and that a caller
//! draining the store and feeding the same bytes again gets the frame it was
//! waiting for, with nothing lost and nothing delivered twice.

const std = @import("std");
const testing = std.testing;
const codec = @import("../../engine/codec/state.zig");
const support = @import("frame_support.zig");

const Frame = support.Frame;

test "a backpressured frame resumes from the byte it stopped at" {
    // A full queue is not a protocol fault and must not be reported as one. The
    // header is taken, the payload is not, and the caller re-feeds the remainder
    // after draining, so nothing is lost and nothing is delivered twice.
    const One = codec.codec(256, 1);
    var peer = One.init(.server);
    var buffers: [2][64]u8 = undefined;
    const first = (Frame{ .opcode = .text, .payload = "a", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffers[0]);
    const second = (Frame{ .opcode = .text, .payload = "b", .mask = .{ 5, 6, 7, 8 } }).bytes(&buffers[1]);
    const header_len = second.len - 1;

    try testing.expectEqual(codec.Outcome.ok, peer.feed(first).outcome);
    const blocked = peer.feed(second);
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);
    try testing.expectEqual(header_len, blocked.consumed);
    try testing.expect(peer.pending_failure() == null);

    try testing.expect(peer.select());
    try testing.expectEqualStrings("a", peer.selected_event().?.payload);
    peer.take();

    const resumed = peer.feed(second[blocked.consumed..]);
    try testing.expectEqual(codec.Outcome.ok, resumed.outcome);
    try testing.expect(peer.select());
    try testing.expectEqualStrings("b", peer.selected_event().?.payload);
    peer.take();
}

test "only one data message is queued at a time" {
    // A queued message's payload is a slice into the single reassembly buffer, so
    // a second one would overwrite the first and the caller would read one
    // message as another. One slot is the fix, and the second frame waits.
    var peer = support.server();
    var buffers: [2][64]u8 = undefined;
    const frames = [_]Frame{
        .{ .opcode = .text, .payload = "one", .mask = .{ 1, 1, 1, 1 } },
        .{ .opcode = .text, .payload = "two", .mask = .{ 2, 2, 2, 2 } },
    };
    try testing.expectEqual(codec.Outcome.ok, peer.feed(frames[0].bytes(&buffers[0])).outcome);
    // The second frame cannot even take its header, because a queued message is
    // still pointing into the reassembly buffer.
    const second = peer.feed(frames[1].bytes(&buffers[1]));
    try testing.expectEqual(codec.Outcome.backpressure, second.outcome);

    try testing.expectEqual(@as(usize, 1), peer.pending());
    try testing.expect(peer.select());
    try testing.expectEqualStrings("one", peer.selected_event().?.payload);
    peer.take();

    // Draining the slot is what lets the waiting frame through, and it arrives
    // intact rather than sharing storage with the message that was just taken.
    const resumed = peer.feed(frames[1].bytes(&buffers[1])[second.consumed..]);
    try testing.expectEqual(codec.Outcome.ok, resumed.outcome);
    try testing.expect(peer.select());
    try testing.expectEqualStrings("two", peer.selected_event().?.payload);
    peer.take();
}

test "control events queue independently of the message slot" {
    // A ping must be answerable while a large message is still waiting, so the
    // control ring is separate and is drained first.
    var peer = support.server();
    var buffers: [4][64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .text, .payload = "msg", .mask = .{ 1, 1, 1, 1 } }).bytes(&buffers[0]));
    try testing.expectEqual(codec.Outcome.ok, peer.feed((Frame{ .opcode = .ping, .payload = "p1", .mask = .{ 2, 2, 2, 2 } }).bytes(&buffers[1])).outcome);
    try testing.expectEqual(codec.Outcome.ok, peer.feed((Frame{ .opcode = .pong, .payload = "p2", .mask = .{ 3, 3, 3, 3 } }).bytes(&buffers[2])).outcome);
    // A second data message waits for the slot, and a second ping does not.
    const blocked = peer.feed((Frame{ .opcode = .text, .payload = "later", .mask = .{ 4, 4, 4, 4 } }).bytes(&buffers[3]));
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);

    try testing.expectEqual(@as(usize, 3), peer.pending());
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
    peer.take();
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.pong, peer.selected_event().?.kind);
    peer.take();
    try testing.expect(peer.select());
    try testing.expectEqualStrings("msg", peer.selected_event().?.payload);
    peer.take();
}

test "a full control ring stops the decoder before the payload is copied" {
    const One = codec.codec(256, 1);
    var peer = One.init(.server);
    var buffers: [2][64]u8 = undefined;
    // Four payload bytes, so a two-byte trim off the front would be visible.
    try testing.expectEqual(codec.Outcome.ok, peer.feed((Frame{ .opcode = .ping, .payload = "keep", .mask = .{ 1, 1, 1, 1 } }).bytes(&buffers[0])).outcome);
    const blocked = peer.feed((Frame{ .opcode = .ping, .payload = "b", .mask = .{ 2, 2, 2, 2 } }).bytes(&buffers[1]));
    try testing.expectEqual(codec.Outcome.backpressure, blocked.outcome);
    try testing.expect(peer.pending_failure() == null);

    // The queued ping still reads as itself, which is the point: the second
    // frame's payload never reached the buffer the first one points at.
    try testing.expect(peer.select());
    const event = peer.selected_event().?;
    try testing.expectEqual(codec.Kind.ping, event.kind);
    try testing.expectEqualStrings("keep", event.payload);
    peer.take();
}

test "reset drops buffered state so a connection can be reused" {
    var peer = support.server();
    var buffers: [2][64]u8 = undefined;
    _ = peer.feed((Frame{ .opcode = .text, .payload = "x", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffers[0]));
    try testing.expectEqual(@as(usize, 1), peer.pending());
    peer.reset();
    try support.take_none(&peer);
    try testing.expect(peer.pending_failure() == null);
    // A fresh connection on the same codec decodes normally.
    _ = peer.feed((Frame{ .opcode = .text, .payload = "y", .mask = .{ 1, 2, 3, 4 } }).bytes(&buffers[1]));
    try testing.expectEqualStrings("y", (try support.take_only(&peer)).payload);
}
