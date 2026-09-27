//! Trusted server configuration.
//!
//! JavaScript values cross the boundary once, are validated against the
//! compile-time engine capacities, and are copied into fixed-capacity structs.
//! Every later native call takes the trusted record and performs no further
//! bounds work.

const std = @import("std");
const capacities = @import("capacities.zig");

pub const connection_capacity = capacities.connection_capacity;
pub const message_capacity = capacities.message_capacity;
pub const frame_capacity = capacities.frame_capacity;
pub const write_queue_capacity = capacities.write_queue_capacity;
pub const body_capacity = capacities.body_capacity;
pub const idle_timeout_ms = capacities.idle_timeout_ms;
pub const host_capacity = capacities.host_capacity;
pub const path_capacity = capacities.path_capacity;
pub const min_frame_bytes = capacities.min_frame_bytes;
pub const max_port = capacities.max_port;
pub const max_backlog = capacities.max_backlog;

pub const Error = error{
    InvalidHost,
    InvalidPort,
    InvalidBacklog,
    InvalidPath,
    InvalidConnectionCapacity,
    InvalidMessageCapacity,
    InvalidFrameCapacity,
};

/// Exact JavaScript safe-integer width. Node-API reads this from a plain
/// number without wrapping; `u32` would silently truncate values above 2^32.
pub const JsInt = i53;

/// Untrusted values exactly as JavaScript passes them.
pub const RawConfig = struct {
    host: []const u8 = "127.0.0.1",
    port: JsInt,
    backlog: JsInt = 128,
    path: []const u8 = "/",
    max_connections: JsInt = connection_capacity,
    max_message_bytes: JsInt = message_capacity,
    max_frame_bytes: JsInt = frame_capacity,
};

/// Per-route limits handed to the engine WebSocket behavior.
pub const Limits = struct {
    max_connections: u32,
    max_message_bytes: u32,
    max_frame_bytes: u32,
};

/// Immutable listen address copied out of the JavaScript argument.
pub const ListenConfig = struct {
    host_len: u8,
    host: [host_capacity]u8,
    port: u16,
    backlog: u16,

    /// NUL-terminated host. The engine binds this address and port.
    pub fn host_slice(config: *const ListenConfig) [:0]const u8 {
        return config.host[0..config.host_len :0];
    }
};

/// The trusted record every engine call consumes. The engine ignores the
/// backlog, which is retained for transports that accept it later and for the
/// compatibility layer's `server.address()` bookkeeping.
pub const ServerConfig = struct {
    listen: ListenConfig,
    path_len: u8,
    path: [path_capacity]u8,
    limits: Limits,

    /// NUL-terminated route path the WebSocket upgrade is registered under.
    pub fn path_slice(config: *const ServerConfig) [:0]const u8 {
        return config.path[0..config.path_len :0];
    }
};

/// Validates untrusted values once and copies them into fixed storage.
pub fn trust(raw: RawConfig) Error!ServerConfig {
    if (raw.port < 0 or raw.port > max_port) return error.InvalidPort;
    if (raw.backlog < 0 or raw.backlog > max_backlog) return error.InvalidBacklog;

    var host: [host_capacity]u8 = undefined;
    const host_len = copy_text(host_capacity, &host, raw.host) orelse return error.InvalidHost;

    var path: [path_capacity]u8 = undefined;
    const path_len = copy_text(path_capacity, &path, raw.path) orelse return error.InvalidPath;
    if (path[0] != '/') return error.InvalidPath;

    const limits = try trust_limits(raw);
    return .{
        .listen = .{
            .host_len = host_len,
            .host = host,
            .port = @intCast(raw.port),
            .backlog = @intCast(raw.backlog),
        },
        .path_len = path_len,
        .path = path,
        .limits = limits,
    };
}

fn trust_limits(raw: RawConfig) Error!Limits {
    if (raw.max_connections <= 0 or raw.max_connections > connection_capacity) {
        return error.InvalidConnectionCapacity;
    }
    if (raw.max_message_bytes <= 0 or raw.max_message_bytes > message_capacity) {
        return error.InvalidMessageCapacity;
    }
    if (raw.max_frame_bytes < min_frame_bytes or raw.max_frame_bytes > raw.max_message_bytes) {
        return error.InvalidFrameCapacity;
    }
    return .{
        .max_connections = @intCast(raw.max_connections),
        .max_message_bytes = @intCast(raw.max_message_bytes),
        .max_frame_bytes = @intCast(raw.max_frame_bytes),
    };
}

/// Copies `value` and its NUL sentinel into `dest`, rejecting empties,
/// overflow, and embedded NUL bytes.
fn copy_text(comptime capacity: usize, dest: *[capacity]u8, value: []const u8) ?u8 {
    if (value.len == 0 or value.len >= capacity) return null;
    if (std.mem.indexOfScalar(u8, value, 0) != null) return null;
    @memcpy(dest[0..value.len], value);
    dest[value.len] = 0;
    return @intCast(value.len);
}
