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

/// Subscribes the engine socket to its outbound topic. Engine thread only: the
/// subscription table is read by the topic publisher on this same thread.
pub fn subscribe(server: *instance.Instance, ws: *uwz.WebSocket, index: u32, generation: u32) void {
    const app = server.cluster.worker(0) orelse return;
    var buffer: [topic_capacity]u8 = undefined;
    app.pubsub.subscribe(ws, write_topic(&buffer, index, generation)) catch {};
}
