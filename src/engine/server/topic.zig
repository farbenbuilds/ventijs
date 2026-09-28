//! Outbound topic naming and per-connection subscription. Two generations of the same
//! slot get different topics, so a payload staged by a closed connection can never be
//! delivered to the connection that recycled its slot.

const std = @import("std");
const uwz = @import("uWebZockets");
const instance = @import("instance.zig");

/// Topic prefix for one connection's outbound channel. The engine's topic registry caps
/// names at 127 bytes and rejects an empty one, so the prefix is fixed and only the two
/// `u32` values follow; twenty bytes is a generous bound for both in decimal.
pub const TOPIC_PREFIX = "ventijs:conn:";
pub const topic_capacity = TOPIC_PREFIX.len + 20;

pub fn write_topic(buffer: *[topic_capacity]u8, index: u32, generation: u32) []const u8 {
    const written = std.fmt.bufPrint(buffer, TOPIC_PREFIX ++ "{d}:{d}", .{ index, generation }) catch unreachable;
    return written;
}

/// Outcome of one subscription attempt. A refusal is not cosmetic: without a
/// subscription the connection has no outbound path, so every payload published for it
/// finds no subscriber, the publisher reports zero deliveries, and the pump then frees
/// the record and reports success. The bytes are gone and the application was told they
/// were sent.
pub const Subscribed = enum(u8) { ok, capacity_reached, no_worker };

/// Engine thread only: the subscription table is read by the topic publisher on this
/// same thread. `PubSubEngine.subscribe` fails at 1024 live topics or 8192 subscriptions,
/// and a connection that opened while the table was full would otherwise be announced as
/// `connection_open` and then be permanently unwritable. The caller terminates it
/// instead, so a refusal costs one connection rather than the server's ability to write.
pub fn subscribe(server: *instance.Instance, ws: *uwz.WebSocket, index: u32, generation: u32) Subscribed {
    const app = server.cluster.worker(0) orelse return .no_worker;
    var buffer: [topic_capacity]u8 = undefined;
    app.pubsub.subscribe(ws, write_topic(&buffer, index, generation)) catch {
        return .capacity_reached;
    };
    return .ok;
}
