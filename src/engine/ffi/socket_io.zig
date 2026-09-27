//! FFI-facing per-connection operations.
//!
//! Every entry point resolves the server through the instance table and the
//! connection through the generation-checked slab before touching a record, so
//! a call against a closed connection returns a typed status instead of
//! dereferencing a stale slot. The resolved generation travels with the call
//! so a recycled slot cannot receive a stale operation. Payload bytes are
//! copied into the bounded staging ring during the call; JavaScript memory is
//! never retained.

const napi = @import("napi-zig");
const handles = @import("../socket/handles.zig");
const instance = @import("../server/instance.zig");
const payload = @import("../socket/payload.zig");
const status = @import("../socket/status.zig");

/// Ordinal into `NATIVE_SOCKET_STATUSES` in `src/binding/native.ts`. Ordinals
/// keep the per-message path free of JS string allocation.
pub const Status = u8;

/// Stages one outbound text or binary message for a connection handle.
/// Payloads above the trusted frame cap are rejected before staging.
pub fn send_socket(
    env: napi.Env,
    server: u40,
    connection: u64,
    data: []const u8,
    binary: bool,
) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    if (data.len > target.config.limits.max_frame_bytes) {
        return @intFromEnum(status.Status.payload_too_large);
    }
    const kind: payload.Kind = if (binary) .binary else .text;
    return @intFromEnum(target.sockets.send(handle.index, handle.generation, kind, data));
}

/// Validates a close code and reason, stages the close frame, and enters
/// `closing` for a connection handle.
pub fn close_socket(
    env: napi.Env,
    server: u40,
    connection: u64,
    code: u16,
    reason: []const u8,
) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(target.sockets.close(handle.index, handle.generation, code, reason));
}

/// Suspends inbound message dispatch for a connection handle.
pub fn pause_socket(env: napi.Env, server: u40, connection: u64) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(target.sockets.pause_dispatch(handle.index, handle.generation));
}

/// Resumes inbound message dispatch for a connection handle.
pub fn resume_socket(env: napi.Env, server: u40, connection: u64) !Status {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = resolve_connection(target, connection) orelse {
        return @intFromEnum(status.Status.invalid_handle);
    };
    return @intFromEnum(target.sockets.resume_dispatch(handle.index, handle.generation));
}

/// Bytes staged for a connection handle and not yet drained. A stale handle
/// reads zero, matching `ws` where a closed socket reports no buffered amount.
pub fn socket_buffered_amount(env: napi.Env, server: u40, connection: u64) !u32 {
    const target = instance.lookup(env, server) orelse return error.UnknownServer;
    const handle = resolve_connection(target, connection) orelse return 0;
    return target.sockets.buffered(handle.index, handle.generation);
}

/// Resolves a packed handle and returns it only when the slab still holds that
/// exact generation. The generation travels with the call so the socket record
/// can re-check it under its lock.
fn resolve_connection(target: *instance.Instance, raw: u64) ?handles.Handle {
    return instance.resolve_connection(target, raw);
}
