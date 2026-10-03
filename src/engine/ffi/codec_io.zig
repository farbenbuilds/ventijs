//! The feed half of the codec boundary: folding bytes in and the small state reads around
//! it. The event half lives in `codec_events.zig`.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// Folds bytes into a codec and reports how many it took. A negative return is the negated
/// ordinal into `CODEC_OUTCOME`; the argument is read, never consumed.
pub fn codec_feed(env: napi.Env, handle: u64, bytes: []const u8) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    const result = peer.feed(bytes);
    return switch (result.outcome) {
        .ok => @intCast(result.consumed),
        .backpressure => abi.feed_refusal(.backpressure),
        .failed => abi.feed_refusal(.failed),
    };
}

/// Where the last `codec_feed` stopped. A separate call because the return's sign is
/// already the outcome.
pub fn codec_resume(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.resume_at());
}

pub fn codec_pending(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.pending());
}

pub fn codec_select(env: napi.Env, handle: u64) !bool {
    const peer = handles.resolve(env.handle, handle) orelse return false;
    return peer.select();
}

/// Drops every buffered byte and event: a half-received frame and a formatted outbound
/// frame are the same slot's state.
pub fn codec_reset(env: napi.Env, handle: u64) !void {
    const peer = handles.resolve(env.handle, handle) orelse return;
    peer.reset();
}
