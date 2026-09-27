//! What a codec has to say about itself: the close code it latched, the failure, and
//! the role it was built for.
//!
//! Split from `codec_io.zig` because these are questions about the connection rather
//! than about a message, and none of them moves a payload. A caller that reaches for
//! one of these is asking why a frame was refused, not asking for a frame.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// The close code a refused frame maps to, or 0 while the connection is healthy.
pub fn codec_failure_code(env: napi.Env, handle: u64) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return 0;
    return peer.failure_code();
}

/// The failure ordinal a refused frame produced, or 0 while healthy.
pub fn codec_failure(env: napi.Env, handle: u64) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return 0;
    const failure = peer.pending_failure() orelse return 0;
    return @intFromEnum(failure) + 1;
}

/// The role a codec was created for, so a caller can assert the masking discipline
/// without parsing a header. -1 once the handle is stale.
pub fn codec_role(env: napi.Env, handle: u64) !abi.Count {
    _ = env;
    const role = handles.role_of(handle) orelse return -1;
    return switch (role) {
        .client => 0,
        .server => 1,
    };
}
