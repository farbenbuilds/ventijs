//! Creating and destroying a codec.
//!
//! Split out because the table is the only thing that allocates, and its memory
//! accounting is worth a file of its own: a slot is a word pair and the codec is
//! heap-allocated, so the table costs 16 KB and a connection costs what it costs.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");
const limits = @import("../codec/limits.zig");

/// Builds a codec and returns a generation-checked handle.
///
/// The two ceilings are arguments and they are honoured exactly, because they are
/// the `maxPayload` and `maxFragments` options a caller set on a `WebSocketServer` or
/// a `WebSocket` and a drop-in replacement has to enforce them. They are `Arg` rather
/// than a wider integer for the reason every count on this boundary is: napi-zig maps
/// a signed integer wider than 53 bits to a `bigint` and a narrower one to a `number`,
/// and a `maxPayload` above 4 GiB is a value no process can hold anyway, so the
/// boundary refuses it as a range error instead of wrapping.
///
/// A value above the compiled ceiling is refused rather than clamped, and the
/// refusal is `InvalidMessageCap` rather than a silent substitution. The alternative
/// is the one this boundary used to have by construction: a fixed capacity, reported
/// on `server.options` as `maxPayload`, that no caller could discover was different.
///
/// `validate_utf8` is the one policy flag, and it is 1 unless the caller passed
/// `skipUTF8Validation`, so the default cannot be lost by an argument that arrives as
/// 0 because a JavaScript boolean was `false`.
pub fn codec_create(
    env: napi.Env,
    role: abi.Arg,
    validate_utf8: abi.Arg,
    max_message: abi.Arg,
    max_fragments: abi.Arg,
) !u64 {
    _ = env;
    if (role > @intFromEnum(handles.Role.server)) return error.InvalidRole;
    const side: handles.Role = if (role == 0) .client else .server;
    const trusted = try limits.Limits.trust(max_message, max_fragments, validate_utf8 != 0);
    return (try handles.create(side, trusted)).to_int();
}

/// Releases a codec. A stale handle is a no-op rather than an error, because the
/// only way to hold one is to have already released it.
pub fn codec_destroy(env: napi.Env, handle: u64) !void {
    _ = env;
    handles.destroy(handle);
}
