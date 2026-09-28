//! Unit tests for `queues.discard_inbound`. The defect these pin is a denial of
//! service, not a memory leak: the ring is fixed-capacity, so nothing leaks, but a
//! stranded record deafens every other connection on the server for the process's life.

const std = @import("std");
const testing = std.testing;
const payload = @import("../../engine/socket/payload.zig");
const queues = @import("../../engine/socket/queues.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);

test "a departed connection's records do not strand the connections behind it" {
    // Without a purge, a burst-then-disconnect leaves records whose pair the slab has
    // already retired, and a stranded head makes `take_inbound` return null for every
    // connection while all of them still look healthy.
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "a"));
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "b"));

    try testing.expectEqual(@as(u32, 2), queues.discard_inbound(&slab, 0, 1));

    try testing.expect(queues.stage_inbound(&slab, 1, 1, .text, "c"));
    const live = queues.take_inbound(&slab, 1, 1).?;
    try testing.expectEqualStrings("c", live.bytes);
    queues.release_inbound(&slab, live);
}

test "a purge counts the messages it dropped as inbound loss" {
    // `serverDroppedMessages` is the only inbound-loss number, so a purge that discarded
    // silently would report zero while messages were being lost.
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
    // The purge finds nothing of its own at the head and stops, rather than consuming
    // connection 1's message and delivering it on the wrong socket.
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, 0, 1));
    const owned = queues.take_inbound(&slab, 1, 1).?;
    try testing.expectEqualStrings("live", owned.bytes);
    queues.release_inbound(&slab, owned);
}

test "a purge of a recycled slot does not remove the new occupant's records" {
    // The purge is keyed on the pair the close event carried, and a slot already handed
    // to a new generation must keep its messages.
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
