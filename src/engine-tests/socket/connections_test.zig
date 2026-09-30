//! Unit tests for `src/engine/socket/queues.zig` with two live connections, the case
//! the Autobahn suite cannot reproduce: it opens one connection per case, so a
//! cross-connection mix-up on the payload boundary is invisible to it.

const std = @import("std");
const testing = std.testing;
const handles = @import("../../engine/socket/handles.zig");
const payload = @import("../../engine/socket/payload.zig");
const queues = @import("../../engine/socket/queues.zig");
const socket = @import("../../engine/socket/socket.zig");

const Ring = payload.payload_ring(4, 16);
const Slab = socket.socket_slab(4, Ring, Ring);
const Connections = handles.connection_slab(4);

/// Acquires a live handle and mirrors it into the socket record, the pairing the engine's
/// open path performs.
fn open(connections: *Connections, slab: *Slab, index: u32) !handles.Handle {
    const handle = try connections.acquire(index);
    slab.open(handle.index, handle.generation);
    return handle;
}

test "the outbound ring drains whole and carries each record's own identity" {
    var slab = Slab{};
    slab.open(0, 1);
    slab.open(1, 1);
    _ = slab.send(0, 1, .text, "from-zero");
    _ = slab.send(1, 1, .text, "from-one");

    // The publisher routes on the record's own index and generation, so one drain
    // serves every connection.
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

    // Draining from either connection debits both, because the drain is not scoped to
    // one; a count only its own drain could move would never clear.
    const first = queues.take_outbound(&slab).?;
    queues.release_outbound(&slab, first);
    const second = queues.take_outbound(&slab).?;
    queues.release_outbound(&slab, second);
    try testing.expectEqual(@as(u32, 0), slab.buffered(0, 1));
    try testing.expectEqual(@as(u32, 0), slab.buffered(1, 1));
}

test "an inbound take is refused when the head belongs to another connection" {
    var slab = Slab{};
    var connections = Connections{};
    const zero = try open(&connections, &slab, 0);
    const one = try open(&connections, &slab, 1);

    try testing.expect(queues.stage_inbound(&slab, one.index, one.generation, .text, "for-one") != null);
    // Connection 0 asks and is refused. Nothing routes an inbound payload, so returning
    // the head here would deliver one peer's message on another peer's socket; the cost
    // is a stall for connection 0 until connection 1 drains.
    try testing.expect(queues.take_inbound(&slab, &connections, zero.index, zero.generation, null) == null);
    const owned = queues.take_inbound(&slab, &connections, one.index, one.generation, null).?;
    try testing.expectEqualStrings("for-one", owned.bytes);
    queues.release_inbound(&slab, owned);

    try testing.expect(queues.take_inbound(&slab, &connections, zero.index, zero.generation, null) == null);
    try testing.expect(queues.stage_inbound(&slab, zero.index, zero.generation, .text, "for-zero") != null);
    try testing.expect(queues.take_inbound(&slab, &connections, zero.index, zero.generation, null) != null);
}

test "an inbound take is refused for a stale generation" {
    var slab = Slab{};
    var connections = Connections{};
    const handle = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, handle.index, handle.generation, .text, "payload") != null);
    try testing.expect(queues.take_inbound(&slab, &connections, handle.index, handle.generation, null) != null);
    try testing.expect(queues.take_inbound(&slab, &connections, handle.index, handle.generation -% 1, null) == null);
}

test "staging reports whether the message was accepted" {
    // A refused stage must be visible, so the caller does not announce a message no
    // consumer will ever find. The ring is four slots deep.
    var slab = Slab{};
    slab.open(0, 1);
    for (0..4) |_| {
        try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "fill") != null);
    }
    try testing.expect(queues.stage_inbound(&slab, 0, 1, .text, "refused") == null);
    try testing.expectEqual(@as(u64, 1), slab.inbound.dropped_count());
}
