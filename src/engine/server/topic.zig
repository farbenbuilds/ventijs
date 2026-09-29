//! Outbound topic naming and per-connection subscription; two generations of one slot get
//! different topics, so a payload staged by a closed connection cannot reach the next one.

const std = @import("std");
const uwz = @import("uWebZockets");
const instance = @import("instance.zig");

/// Topic prefix for one connection's outbound channel; the engine caps a name at 127 bytes.
pub const TOPIC_PREFIX = "ventiws:conn:";
pub const topic_capacity = TOPIC_PREFIX.len + 20;

pub fn write_topic(buffer: *[topic_capacity]u8, index: u32, generation: u32) []const u8 {
    const written = std.fmt.bufPrint(buffer, TOPIC_PREFIX ++ "{d}:{d}", .{ index, generation }) catch unreachable;
    return written;
}

/// Outcome of one subscription attempt; a refusal means the payload is published to nobody.
pub const Subscribed = enum(u8) { ok, capacity_reached, no_worker };

/// Engine thread only: the topic publisher reads the table on this thread, and a refusal
/// terminates one connection rather than a server that can no longer write at all.
pub fn subscribe(server: *instance.Instance, ws: *uwz.WebSocket, index: u32, generation: u32) Subscribed {
    const app = server.cluster.worker(0) orelse return .no_worker;
    var buffer: [topic_capacity]u8 = undefined;
    app.pubsub.subscribe(ws, write_topic(&buffer, index, generation)) catch {
        return .capacity_reached;
    };
    return .ok;
}
