//! Unit tests for the inbound ring's purge and take-side skips. A stranded record is not
//! a leak -- the ring is fixed-capacity -- but a dead generation at the head used to deafen
//! every connection, and a record whose announcement the event ring dropped used to be
//! handed over in place of the newer message.

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

test "a departed connection's records do not strand the connections behind it" {
    var slab = Slab{};
    var connections = Connections{};
    const gone = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, gone.index, gone.generation, .text, "a") != null);
    try testing.expect(queues.stage_inbound(&slab, gone.index, gone.generation, .text, "b") != null);
    _ = connections.release(gone.index);

    const live = try open(&connections, &slab, 1);
    const sequence = queues.stage_inbound(&slab, live.index, live.generation, .text, "c").?;
    const view = queues.take_inbound(&slab, &connections, live.index, live.generation, @truncate(sequence)).?;
    try testing.expectEqualStrings("c", view.bytes);
    queues.release_inbound(&slab, view);
    // The two stranded records were skipped and counted, not delivered.
    try testing.expectEqual(@as(u64, 2), slab.inbound.dropped_count());
}

test "a dropped announcement cannot hand an older message to the newer event" {
    var slab = Slab{};
    var connections = Connections{};
    const handle = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, handle.index, handle.generation, .text, "old") != null);
    const newer = queues.stage_inbound(&slab, handle.index, handle.generation, .text, "new").?;

    // The "old" message's event was dropped by the channel, so the take serving "new" may
    // not match it; it is skipped and counted instead of being delivered in new's place.
    const view = queues.take_inbound(&slab, &connections, handle.index, handle.generation, @truncate(newer)).?;
    try testing.expectEqualStrings("new", view.bytes);
    queues.release_inbound(&slab, view);
    try testing.expectEqual(@as(u64, 1), slab.inbound.dropped_count());
}

test "a take for an announcement already consumed does not jump ahead" {
    var slab = Slab{};
    var connections = Connections{};
    const handle = try open(&connections, &slab, 0);
    const first = queues.stage_inbound(&slab, handle.index, handle.generation, .text, "first").?;
    const owned = queues.take_inbound(&slab, &connections, handle.index, handle.generation, @truncate(first)).?;
    queues.release_inbound(&slab, owned);

    try testing.expect(queues.stage_inbound(&slab, handle.index, handle.generation, .text, "second") != null);
    // The first event's sequence is spent; a second take from that handler must not consume
    // the next message, which has its own announcement queued.
    try testing.expect(queues.take_inbound(&slab, &connections, handle.index, handle.generation, @truncate(first)) == null);
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
}

test "a take without an announcement returns the oldest record" {
    var slab = Slab{};
    var connections = Connections{};
    const handle = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, handle.index, handle.generation, .text, "old") != null);
    try testing.expect(queues.stage_inbound(&slab, handle.index, handle.generation, .text, "new") != null);
    const view = queues.take_inbound(&slab, &connections, handle.index, handle.generation, null).?;
    try testing.expectEqualStrings("old", view.bytes);
    queues.release_inbound(&slab, view);
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
}

test "a purge counts the messages it dropped as inbound loss" {
    // `serverDroppedMessages` is the only inbound-loss number, so a purge that discarded
    // silently would report zero while messages were being lost.
    var slab = Slab{};
    try testing.expect(queues.stage_inbound(&slab, 0, 2, .text, "x") != null);
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
    _ = queues.discard_inbound(&slab, 0, 2);
    try testing.expectEqual(@as(u64, 1), slab.inbound.dropped_count());
}

test "a purge never touches another connection's records" {
    var slab = Slab{};
    var connections = Connections{};
    const zero = try open(&connections, &slab, 0);
    const one = try open(&connections, &slab, 1);
    try testing.expect(queues.stage_inbound(&slab, one.index, one.generation, .text, "live") != null);
    // The purge finds nothing of its own at the head and stops, rather than consuming
    // connection 1's message and delivering it on the wrong socket.
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, zero.index, zero.generation));
    const owned = queues.take_inbound(&slab, &connections, one.index, one.generation, null).?;
    try testing.expectEqualStrings("live", owned.bytes);
    queues.release_inbound(&slab, owned);
}

test "a purge of a recycled slot does not remove the new occupant's records" {
    // The purge is keyed on the pair the close event carried, and a slot already handed
    // to a new generation must keep its messages.
    var slab = Slab{};
    var connections = Connections{};
    const first = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, first.index, first.generation, .text, "old") != null);
    try testing.expectEqual(@as(u32, 1), queues.discard_inbound(&slab, first.index, first.generation));

    _ = connections.release(first.index);
    const second = try open(&connections, &slab, 0);
    try testing.expect(queues.stage_inbound(&slab, second.index, second.generation, .text, "new") != null);
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, first.index, first.generation));
    const owned = queues.take_inbound(&slab, &connections, second.index, second.generation, null).?;
    try testing.expectEqualStrings("new", owned.bytes);
    queues.release_inbound(&slab, owned);
}

test "purging an empty ring is a no-op" {
    var slab = Slab{};
    try testing.expectEqual(@as(u32, 0), queues.discard_inbound(&slab, 0, 1));
    try testing.expectEqual(@as(u64, 0), slab.inbound.dropped_count());
}
