//! The event half of the codec boundary: selecting, copying out, and retiring decoded
//! events, plus the fused feed-and-first-event call. Every handle is resolved before a
//! codec is touched, and the caller's bytes are read-only.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

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

/// Selects, copies, and retires the oldest event in one crossing, or null when the store
/// is empty. Kind and close code share one 32-bit slot; `want_ends` is 0 unless
/// `binaryType` is `"fragments"`, the only consumer of the boundaries.
pub fn codec_next(env: napi.Env, handle: u64, want_ends: abi.Arg) !?napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse return null;
    if (!peer.select()) return null;
    const event = peer.selected_event() orelse {
        peer.take();
        return null;
    };
    const buffer = try env.createBuffer(event.payload.len);
    @memcpy(buffer.data[0..event.payload.len], event.payload);
    const kind_code = try env.createUint32(@as(u32, @intFromEnum(event.kind)) << 16 | event.code);
    const result = try env.createArrayWithLength(if (want_ends != 0) 3 else 2);
    try result.setElement(env, 0, kind_code);
    try result.setElement(env, 1, buffer.val);
    if (want_ends != 0) {
        try result.setElement(env, 2, try fragment_array(env, peer.fragment_ends()));
    }
    peer.take();
    return result;
}

/// Folds `bytes`, then copies the first event's payload into the caller's `out` when it
/// fits. Returns `[kindCode, length, ends?]`, the positive byte length when the event did
/// not fit `out`, null when no event came out, or a negative feed refusal. The event stays
/// selected when it did not fit, so `codec_materialize` finishes it without feeding again.
pub fn codec_process_into(
    env: napi.Env,
    handle: u64,
    bytes: []const u8,
    want_ends: abi.Arg,
    out: []const u8,
) !napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse
        return env.createInt32(abi.feed_refusal(.stale_handle));
    const folded = peer.feed(bytes);
    switch (folded.outcome) {
        .ok => {},
        .backpressure => return env.createInt32(abi.feed_refusal(.backpressure)),
        .failed => return env.createInt32(abi.feed_refusal(.failed)),
    }
    if (!peer.select()) return env.createNull();
    return materialize(env, peer, want_ends, out);
}

/// Copies the selected event's payload into `out`; the second half of
/// `codec_process_into`, for an event that did not fit the first buffer.
pub fn codec_materialize(
    env: napi.Env,
    handle: u64,
    want_ends: abi.Arg,
    out: []const u8,
) !napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse return env.createNull();
    return materialize(env, peer, want_ends, out);
}

fn materialize(env: napi.Env, peer: anytype, want_ends: abi.Arg, out: []const u8) !napi.Val {
    const event = peer.selected_event() orelse {
        peer.take();
        return env.createNull();
    };
    if (event.payload.len > out.len) {
        return env.createUint32(@intCast(event.payload.len));
    }
    @memcpy(@constCast(out[0..event.payload.len]), event.payload);
    const kind_code = try env.createUint32(@as(u32, @intFromEnum(event.kind)) << 16 | event.code);
    const result = try env.createArrayWithLength(if (want_ends != 0) 3 else 2);
    try result.setElement(env, 0, kind_code);
    try result.setElement(env, 1, try env.createUint32(@intCast(event.payload.len)));
    if (want_ends != 0) {
        try result.setElement(env, 2, try fragment_array(env, peer.fragment_ends()));
    }
    peer.take();
    return result;
}

/// Null without an interior boundary, matching `codec_fragments`.
fn fragment_array(env: napi.Env, ends: []const u32) !napi.Val {
    if (ends.len < 2) return env.createNull();
    const array = try env.createArrayWithLength(@intCast(ends.len));
    for (ends, 0..) |end, index| {
        try array.setElement(env, @intCast(index), try env.createUint32(end));
    }
    return array;
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
    return try fragment_array(env, peer.fragment_ends());
}
