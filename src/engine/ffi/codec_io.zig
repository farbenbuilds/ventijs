//! Flat and scalar, with every handle resolved before a codec is touched, so a destroyed
//! codec is a typed status and never a freed dereference. `ingest` is the one deliberate
//! copy: the codec unmasks in place, and a held `Buffer` must not be unmasked under it.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// Folds bytes into a codec and reports how many it took. A negative return is the negated
/// ordinal into `CODEC_OUTCOME`, and bytes from the returned offset onward must be fed
/// again after draining. The argument is read, never consumed, so the same bytes can go
/// to a second codec, which is what a conformance comparison needs.
pub fn codec_feed(env: napi.Env, handle: u64, bytes: []const u8) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    // One memcpy per scratch piece rather than per frame, and the caller's buffer
    // comes back unchanged.
    const result = peer.ingest(bytes);
    return switch (result.outcome) {
        .ok => @intCast(result.consumed),
        .backpressure => abi.feed_refusal(.backpressure),
        .failed => abi.feed_refusal(.failed),
    };
}

/// Where the last `codec_feed` stopped. A separate call because the return's sign is
/// already the outcome; guessing this wrong drops bytes or delivers a frame twice.
pub fn codec_resume(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.resume_at());
}

/// Events waiting to be taken, so a caller can loop without calling `codec_select`.
pub fn codec_pending(env: napi.Env, handle: u64) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.pending());
}

/// Selects the next event, or reports that there is none.
pub fn codec_select(env: napi.Env, handle: u64) !bool {
    const peer = handles.resolve(env.handle, handle) orelse return false;
    return peer.select();
}

/// The selected event as `[kind, code, payload]`. The payload is copied because it borrows
/// a buffer inside the codec that the next frame overwrites: a handed-out `Buffer` has to
/// be the only copy, or a listener retaining it reads the next message's bytes.
pub fn codec_event(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse return null;
    const event = peer.selected_event() orelse return null;
    const buffer = try env.createBuffer(event.payload.len);
    @memcpy(buffer.data[0..event.payload.len], event.payload);
    const kind = try env.createUint32(@intFromEnum(event.kind));
    const code = try env.createUint32(event.code);
    const result = try env.createArrayWithLength(3);
    try result.setElement(env, 0, kind);
    try result.setElement(env, 1, code);
    try result.setElement(env, 2, buffer.val);
    return result;
}

pub fn codec_take(env: napi.Env, handle: u64) !void {
    const peer = handles.resolve(env.handle, handle) orelse return;
    peer.take();
}

/// The fragment boundaries of the selected data message, ascending, read between
/// `codec_event` and `codec_take`, the only window the reassembly buffer is still this
/// message. Null without an interior boundary, and copied out because the boundaries live
/// in codec memory the next message overwrites.
pub fn codec_fragments(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse return null;
    const ends = peer.fragment_ends();
    if (ends.len < 2) return null;
    const array = try env.createArrayWithLength(@intCast(ends.len));
    for (ends, 0..) |end, index| {
        try array.setElement(env, @intCast(index), try env.createUint32(end));
    }
    return array;
}

/// Drops every buffered byte and event. Lives here rather than with either direction
/// because it touches both: a half-received frame and a formatted outbound frame are the
/// same slot's state.
pub fn codec_reset(env: napi.Env, handle: u64) !void {
    const peer = handles.resolve(env.handle, handle) orelse return;
    peer.reset();
}
