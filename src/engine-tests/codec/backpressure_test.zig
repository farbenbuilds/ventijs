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
    try testing.expectEqualStrings("p1", peer.selected_event().?.payload);
    peer.take();
    try testing.expect(peer.select());
    try testing.expectEqual(codec.Kind.pong, peer.selected_event().?.kind);
    try testing.expectEqualStrings("p2", peer.selected_event().?.payload);
    peer.take();
    try testing.expect(peer.select());
    try testing.expectEqualStrings("msg", peer.selected_event().?.payload);
    peer.take();
}

test "every queued control event keeps its own payload" {
    // A control payload is written into one shared 125-byte buffer as it arrives, so
    // a ring of events that stored a slice into it would hand the caller the newest
    // frame's bytes for every event. All eight land in one feed, which is the order
    // that exposes the aliasing: nothing is taken until the ring is full.
    const payloads = [_][]const u8{ "a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg", "hhhhhhhh" };
    var peer = support.server();
    var scratch: [8][32]u8 = undefined;
    var joined: [512]u8 = undefined;
    var written: usize = 0;
    for (payloads, 0..) |payload, index| {
        const frame = (Frame{
            .opcode = .ping,
            .payload = payload,
            .mask = .{ @intCast(index + 1), 2, 3, 4 },
        }).bytes(&scratch[index]);
        @memcpy(joined[written..][0..frame.len], frame);
        written += frame.len;
    }
    const all = joined[0..written];
    try testing.expectEqual(codec.Outcome.ok, peer.feed(all).outcome);
    try testing.expectEqual(payloads.len, peer.pending());

    // Every event's payload is its own, which is the whole point: eight slices into
    // one buffer would all read "hhhhhhhh".
    for (payloads) |expected| {
        try testing.expect(peer.select());
        try testing.expectEqual(codec.Kind.ping, peer.selected_event().?.kind);
        try testing.expectEqualStrings(expected, peer.selected_event().?.payload);
        peer.take();
    }
    try support.take_none(&peer);
}

test "a refused frame's code outlives the event that reported it" {
    // The `rejected` event carries a description, not a close code: one refused frame
    // maps to one code for the whole connection, latched on the codec.
    var peer = support.server();
    var buffer: [32]u8 = undefined;
    // An unmasked frame to a server: a protocol error, and 1002.
    const frame = support.raw_frame(&buffer, true, 0x1, 1, false, .{ 0, 0, 0, 0 }, "x");
    try testing.expectEqual(codec.Outcome.failed, peer.feed(frame).outcome);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
    const event = try support.take_only(&peer);
    try testing.expectEqual(codec.Kind.rejected, event.kind);
    // The event's own code is zero: it is the description that is queued, and a
    // caller that mistook it for a close code would send 0, which is not a code.
    try testing.expectEqual(@as(u16, 0), event.code);
    // A later call reports the same reason rather than a fresh, healthy one.
    try testing.expectEqual(codec.Outcome.failed, peer.feed(frame).outcome);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}
