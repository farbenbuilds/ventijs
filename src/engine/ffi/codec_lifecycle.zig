//! Creating and destroying a codec.
//!
//! Split out because the table is the only thing that allocates, and its memory
//! accounting is worth a file of its own: a slot is a word pair and the codec is
//! heap-allocated, so the table costs 16 KB and a connection costs what it costs.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// Builds a codec and returns a generation-checked handle.
///
/// The capacity is not an argument: every codec has the compiled one, and
/// `engineLimits` reports it. Taking a capacity here and honouring it only in part
/// would be the worst of both, because a caller would have no way to tell.
///
/// `validate_utf8` is the one policy the caller does choose, and it is per codec
/// rather than per connection because a codec is one connection. It is 1 unless the
/// caller passed `skipUTF8Validation`, so the default cannot be lost by an argument
/// that arrives as 0 because a JavaScript boolean was `false`.
pub fn codec_create(env: napi.Env, role: abi.Arg, validate_utf8: abi.Arg) !u64 {
    _ = env;
    if (role > @intFromEnum(handles.Role.server)) return error.InvalidRole;
    const side: handles.Role = if (role == 0) .client else .server;
    const handle = handles.create(side, validate_utf8 != 0) catch |err| {
        return switch (err) {
            error.CodecTableFull => error.CodecTableFull,
            error.InvalidCapacity => error.InvalidCapacity,
            error.UnknownCodec => unreachable,
        };
    };
    return handle.to_int();
}

/// Releases a codec. A stale handle is a no-op rather than an error, because the
/// only way to hold one is to have already released it.
pub fn codec_destroy(env: napi.Env, handle: u64) !void {
    _ = env;
    handles.destroy(handle);
}
