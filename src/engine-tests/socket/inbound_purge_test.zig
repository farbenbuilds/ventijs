//! Unit tests for `queues.discard_inbound`, the purge that reclaims the inbound
//! ring space a departed connection leaves behind.
//!
//! The defect these pin is a denial of service, not a memory leak. The inbound
//! ring is fixed-capacity, so nothing leaks; the failure is that a stranded
//! record makes every *other* connection on the server unable to receive a
//! message, for the life of the process, after a single peer disconnects.

const std = @import("std");
const testing = std.testing;
const payload = @import("../../engine/socket/payload.zig");
const queues = @import("../../engine/socket/queues.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);

test "a departed connection's records do not strand the connections behind it" {
    // The failure this pins. Without a purge, a peer that sends a burst and
    // disconnects leaves records whose `(index, generation)` the slab has already
    // retired. Nothing can ever match them again, and because the inbound ring is
    // strictly FIFO with one consumer, the stranded head makes `take_inbound`
    // return null for *every* connection on the server. The server then refuses
    // every stage and counts a drop for each, while every connection still looks
    // healthy. That is a permanent outage caused by one peer's disconnect.
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "a"));
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "b"));

    // The purge runs on close, for the pair the slab has just retired.
    try testing.expectEqual(@as(u32, 2), queues.discard_inbound(&slab, 0, 1));

    // Connection 1 drains again, which it could not have done before.
    try testing.expect(queues.stage_inbound(&slab, 1, 1, .text, "c"));
    const live = queues.take_inbound(&slab, 1, 1).?;
    try testing.expectEqualStrings("c", live.bytes);
    queues.release_inbound(&slab, live);
}

test "a purge counts the messages it dropped as inbound loss" {
    // `serverDroppedMessages` is the single inbound-loss number, so a purge that
    // silently discarded bytes would leave the one counter that a caller can read
    // reporting zero while messages were being lost.
    var slab = Slab{};
    slab.open(0, 2);
    try testing.expect(queues.stage_inbound(&slab, 0, 2, .text, "x"));
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
    _ = queues.discard_inbound(&slab, 0, 2);
    try testing.expectEqual(@as(u64, 1), slab.inbound.dropped_count());
}

test "a purge never touches another connection's records" {
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    try testing.expect(queues.stage_inbound(&slab, 1, 1, .text, "live"));
    // Connection 0's purge finds nothing of its own at the head and stops, rather
    // than consuming connection 1's message and delivering it on the wrong socket.
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, 0, 1));
    const owned = queues.take_inbound(&slab, 1, 1).?;
    try testing.expectEqualStrings("live", owned.bytes);
    queues.release_inbound(&slab, owned);
}

test "a purge of a recycled slot does not remove the new occupant's records" {
    // The purge is keyed on the pair the close event carried, and a slot that has
    // already been handed to a new generation must keep its messages.
    var slab = Slab{};
    slab.open(0, 1);
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "old"));
    try testing.expectEqual(@as(u32, 1), queues.discard_inbound(&slab, 0, 1));

    slab.open(0, 2);
    try testing.expect(queues.stage_inbound(&slab, 0, 2, .text, "new"));
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, 0, 1));
    const owned = queues.take_inbound(&slab, 0, 2).?;
    try testing.expectEqualStrings("new", owned.bytes);
    queues.release_inbound(&slab, owned);
}

test "purging an empty ring is a no-op" {
    var slab = Slab{};
    slab.open(0, 1);
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, 0, 1));
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
}
