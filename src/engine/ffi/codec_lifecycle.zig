//! Creating and destroying a codec, split out because the table is the only thing that
//! allocates: a slot is a word pair, so the table costs 16 KB and a connection its own.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");
const limits = @import("../codec/limits.zig");

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
    _ = env;
    if (role > @intFromEnum(handles.Role.server)) return error.InvalidRole;
    const side: handles.Role = if (role == 0) .client else .server;
    const trusted = try limits.Limits.trust(
        max_message,
        max_fragments,
        validate_utf8 != 0,
        permessage_deflate != 0,
    );
    return (try handles.create(side, trusted)).to_int();
}

/// Releases a codec; a stale handle is a no-op, because the only way to hold one is
/// to have already released it.
pub fn codec_destroy(env: napi.Env, handle: u64) !void {
    _ = env;
    handles.destroy(handle);
}
