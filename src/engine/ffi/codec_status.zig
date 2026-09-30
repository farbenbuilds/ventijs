//! What a codec has to say about itself: the close code it latched, the failure, and
//! the role it was built for. None of these moves a payload.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// The close code a refused frame maps to, or 0 while the connection is healthy.
pub fn codec_failure_code(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return 0;
    return peer.failure_code();
}

/// The failure ordinal a refused frame produced, offset by one so 0 can mean healthy.
pub fn codec_failure(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return 0;
    const failure = peer.pending_failure() orelse return 0;
    return @intFromEnum(failure) + 1;
}

/// The role a codec was created for, so a caller can assert the masking discipline
/// without parsing a header. -1 once the handle is stale.
pub fn codec_role(env: napi.Env, handle: u64) !abi.Count {
    const role = handles.role_of(env.handle, handle) orelse return -1;
    return switch (role) {
        .client => 0,
        .server => 1,
    };
}

/// The per-connection ceilings a codec enforces, as `[maxPayload, maxFragments]`, or
/// null once the handle is stale. One crossing rather than two, because a caller that
/// set a limit and wants to confirm it wants both halves of the answer together.
pub fn codec_ceilings(env: napi.Env, handle: u64) !?napi.Val {
    if (handles.resolve(env.handle, handle) == null) return null;
    const ceilings = handles.ceilings_of(env.handle, handle);
    const message = try env.createUint32(@intCast(ceilings[0]));
    const fragments = try env.createUint32(@intCast(ceilings[1]));
    const out = try env.createArrayWithLength(2);
    try out.setElement(env, 0, message);
    try out.setElement(env, 1, fragments);
    return out;
}
