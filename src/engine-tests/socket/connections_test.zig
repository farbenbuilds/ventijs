//! Unit tests for `src/engine/socket/queues.zig` with two live connections,
//! which is the case the Autobahn suite cannot reproduce: it opens one
//! connection per case, so a cross-connection mix-up on the payload boundary is
//! invisible to it.
//!
//! Every check is about identity rather than throughput. The two rings differ on
//! purpose and these tests are what hold that difference in place.

const std = @import("std");
const testing = std.testing;
const payload = @import("../../engine/socket/payload.zig");
const queues = @import("../../engine/socket/queues.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);

test "the outbound ring drains whole and carries each record's own identity" {
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    _ = slab.send(0, 1, .text, "from-zero");
    _ = slab.send(1, 1, .text, "from-one");

    // The publisher routes on the record's own index and generation, so one drain
    // serves every connection and neither payload waits for the other.
    const first = queues.take_outbound(&slab).?;
    try testing.expectEqual(@as(u32, 0), first.index);
    try testing.expectEqualStrings("from-zero", first.bytes);
    queues.release_outbound(&slab, first);

    const second = queues.take_outbound(&slab).?;
    try testing.expectEqual(@as(u32, 1), second.index);
    try testing.expectEqualStrings("from-one", second.bytes);
    queues.release_outbound(&slab, second);

    try testing.expect(queues.take_outbound(&slab) == null);
}

test "an outbound drain debits the owning connection's buffered amount" {
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    _ = slab.send(0, 1, .text, "0123456789");
    _ = slab.send(1, 1, .text, "abcde");
    try testing.expectEqual(@as(u32, 10), slab.buffered(0, 1));
    try testing.expectEqual(@as(u32, 5), slab.buffered(1, 1));

    // Draining from either connection debits both, because the drain is not
    // scoped to one. A per-connection count that only its own drain could move
    // would leave the other connection's bytes counted forever.
    const first = queues.take_outbound(&slab).?;
    queues.release_outbound(&slab, first);
    const second = queues.take_outbound(&slab).?;
    queues.release_outbound(&slab, second);
    try testing.expectEqual(@as(u32, 0), slab.buffered(0, 1));
    try testing.expectEqual(@as(u32, 0), slab.buffered(1, 1));
}

test "an inbound take is refused when the head belongs to another connection" {
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);

    try testing.expect(queues.stage_inbound(&slab, 1, 1, .text, "for-one"));
    // Connection 0 asks and is refused. Nothing routes an inbound payload: the
    // consumer is told which connection to take from and is handed the bytes, so
    // returning the head here would deliver one peer's message on another peer's
    // socket. The cost is a stall for connection 0 until connection 1 drains.
    try testing.expect(queues.take_inbound(&slab, 0, 1) == null);
    const owned = queues.take_inbound(&slab, 1, 1).?;
    try testing.expectEqualStrings("for-one", owned.bytes);
    queues.release_inbound(&slab, owned);

    try testing.expect(queues.take_inbound(&slab, 0, 1) == null);
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "for-zero"));
    try testing.expect(queues.take_inbound(&slab, 0, 1) != null);
}

test "an inbound take is refused for a stale generation" {
    var slab = Slab{};
    slab.open(0, 4);
    try testing.expect(queues.stage_inbound(&slab, 0, 4, .text, "payload"));
    try testing.expect(queues.take_inbound(&slab, 0, 4) != null);
    try testing.expect(queues.take_inbound(&slab, 0, 3) == null);
}

test "staging reports whether the message was accepted" {
    // A refused stage must be visible, so the caller does not announce a message
    // no consumer will ever find. The ring is four slots deep, so the fifth stage
    // is the one that is refused.
    var slab = Slab{};
    slab.open(0, 1);
    for (0..4) |_| {
        try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "fill"));
    }
    try testing.expect(!queues.stage_inbound(&slab, 0, 1, .text, "refused"));
    try testing.expectEqual(@as(u64, 1), slab.inbound.dropped_count());
}
