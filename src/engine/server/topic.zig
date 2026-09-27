//! Outbound topic naming and per-connection subscription.
//!
//! Every connection gets a topic derived from its slab index and generation, and
//! the engine's outbound path publishes to it. Two generations of the same slot
//! get different topics, so a payload staged by a closed connection can never be
//! delivered to the connection that recycled its slot. The naming lives here
//! rather than beside the route wiring because both the engine thread, which
//! subscribes, and the Node-side pump, which publishes, have to agree on it
//! exactly.

const std = @import("std");
const uwz = @import("uWebZockets");
const instance = @import("instance.zig");

/// Topic prefix for one connection's outbound channel. The engine's topic
/// registry caps names at 127 bytes and rejects an empty one, so the prefix is
/// fixed and only the index and generation follow. Twenty bytes is a generous
/// bound for two `u32` values written in decimal plus the separator.
pub const TOPIC_PREFIX = "ventijs:conn:";
pub const topic_capacity = TOPIC_PREFIX.len + 20;

/// Writes the topic name for one connection generation.
pub fn write_topic(buffer: *[topic_capacity]u8, index: u32, generation: u32) []const u8 {
    const written = std.fmt.bufPrint(buffer, TOPIC_PREFIX ++ "{d}:{d}", .{ index, generation }) catch unreachable;
    return written;
}

/// Outcome of one subscription attempt. A refused subscription is not a
/// cosmetic failure: without it the connection has no outbound path at all, so
/// every payload published for it finds no subscriber, the publisher reports
/// zero deliveries, and the pump then frees the record and reports success. The
/// bytes are gone and the application was told they were sent.
pub const Subscribed = enum(u8) { ok, capacity_reached, no_worker };

/// Subscribes the engine socket to its outbound topic. Engine thread only: the
/// subscription table is read by the topic publisher on this same thread.
///
/// The error is named rather than swallowed. `PubSubEngine.subscribe` fails with
/// `TopicCapacityReached` at 1024 live topics or `SubscriptionCapacityReached` at
/// 8192 subscriptions, and a connection that opened while the table was full would
/// otherwise be announced to JavaScript as `connection_open` and then be
/// permanently unwritable. The caller terminates the connection instead, so a
/// refused subscription costs one connection rather than the server's ability to
/// write to any of them.
pub fn subscribe(server: *instance.Instance, ws: *uwz.WebSocket, index: u32, generation: u32) Subscribed {
    const app = server.cluster.worker(0) orelse return .no_worker;
    var buffer: [topic_capacity]u8 = undefined;
    app.pubsub.subscribe(ws, write_topic(&buffer, index, generation)) catch {
        return .capacity_reached;
    };
    return .ok;
}
