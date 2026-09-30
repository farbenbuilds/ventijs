//! Creating and destroying a codec, split out because the table is the only thing that
//! allocates: a slot is a word pair, so the table costs 16 KB and a connection its own.
//! The environment cleanup hook is registered with the environment's first codec and
//! removed with its last, so a worker that exits drains exactly its own codecs.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");
const limits = @import("../codec/limits.zig");

const c = napi.c;

/// Builds a codec and returns a generation-checked handle. The two ceilings are the
/// `maxPayload` and `maxFragments` a caller set, honoured exactly and refused rather than
/// clamped above the compiled ceiling. The two flags are 1 unless the caller asked otherwise,
/// and `permessage_deflate` is 0 unless the handshake answered `Sec-WebSocket-Extensions`.
pub fn codec_create(
    env: napi.Env,
    role: abi.Arg,
    validate_utf8: abi.Arg,
    max_message: abi.Arg,
    max_fragments: abi.Arg,
    permessage_deflate: abi.Arg,
) !u64 {
    if (role > @intFromEnum(handles.Role.server)) return error.InvalidRole;
    const side: handles.Role = if (role == 0) .client else .server;
    const trusted = try limits.Limits.trust(
        max_message,
        max_fragments,
        validate_utf8 != 0,
        permessage_deflate != 0,
    );
    const handle = try handles.create(env.handle, side, trusted);
    errdefer _ = handles.destroy(env.handle, handle.to_int());
    if (handles.env_count(env.handle) == 1) try register(env);
    return handle.to_int();
}

/// Releases a codec; a stale handle, a handle from another environment, and a second
/// release are all no-ops, because the only way to hold one is to have already released it.
pub fn codec_destroy(env: napi.Env, handle: u64) !void {
    if (handles.destroy(env.handle, handle)) remove(env);
}

/// Registers the teardown drain once per environment; the hook pair is keyed on the
/// environment itself, so an environment that spawns and exits twice never loops.
fn register(env: napi.Env) !void {
    if (c.napi_add_env_cleanup_hook(env.handle, on_env_cleanup, @ptrCast(env.handle)) != .ok) {
        return error.EnvCleanupUnavailable;
    }
}

/// Removes the drain with the environment's last codec, so the hook cannot fire after an
/// explicit destroy and double-free.
fn remove(env: napi.Env) void {
    _ = c.napi_remove_env_cleanup_hook(env.handle, on_env_cleanup, @ptrCast(env.handle));
}

fn on_env_cleanup(raw: ?*anyopaque) callconv(.c) void {
    const env: c.napi_env = @ptrCast(@alignCast(raw orelse return));
    handles.destroy_env(env);
}
