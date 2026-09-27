//! The inbound half of the codec boundary.
//!
//! Every entry point resolves its handle through the generation-checked table
//! before touching a codec, so a call against a destroyed one is a typed status
//! rather than a dereference of freed memory. Nothing here returns an engine
//! pointer: an event's payload is copied into a JavaScript-owned `Buffer` inside
//! the call that reads it, which is what keeps codec memory unreachable from
//! JavaScript.
//!
//! The surface is deliberately flat and scalar. A caller never sees the codec's
//! state machine, never computes a frame size, and never learns which buffer a
//! payload came from. It feeds bytes, takes bytes, and is told a status.
//!
//! The bytes go through `ingest`, not `feed`, and that is the boundary's one
//! deliberate copy. The codec unmasks a frame in place -- which saves a copy of
//! every byte a client sends, and is what the engine's own `WebSocket.on_data` does
//! over the same `zslay` primitives -- and Node-API cannot hand Zig a mutable slice,
//! so a `Buffer` the application may still be holding must not be unmasked underneath
//! it. `ingest` copies each piece into a stack scratch and the codec unmasks *that*.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// Folds bytes into a codec and reports how many it took.
///
/// A negative return is the negated ordinal into `CODEC_OUTCOME`, so the caller
/// learns both how much was consumed and why the codec stopped. Bytes from the
/// returned offset onward have to be fed again after draining, which is what lets a
/// peer control the read boundary without the codec buffering a second copy of
/// anything.
///
/// The argument is not consumed. It is read and left alone, so a caller may feed the
/// same bytes to a second codec -- which is what a conformance comparison needs, and
/// what the old in-place contract made impossible.
pub fn codec_feed(env: napi.Env, handle: u64, bytes: []const u8) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return abi.feed_refusal(.stale_handle);
    // `ingest`, not `feed`: one memcpy per `ingest_scratch` piece rather than per
    // frame, and the caller's buffer comes back unchanged.
    const result = peer.ingest(bytes);
    return switch (result.outcome) {
        .ok => @intCast(result.consumed),
        .backpressure => abi.feed_refusal(.backpressure),
        .failed => abi.feed_refusal(.failed),
    };
}

/// Where the last `codec_feed` stopped, for a caller resuming a partial input.
///
/// A separate call because the return's sign is already the outcome: a non-negative
/// return is the byte count, and a negative one is the reason there is no count to
/// report. Without this the caller would have to guess where a backpressured input
/// resumes, and a wrong guess either drops bytes or delivers a frame twice.
pub fn codec_resume(env: napi.Env, handle: u64) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.resume_at());
}

/// Events waiting to be taken, so a caller can loop without calling `select` to
/// find out.
pub fn codec_pending(env: napi.Env, handle: u64) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return abi.feed_refusal(.stale_handle);
    return @intCast(peer.pending());
}

/// Selects the next event, or reports that there is none.
pub fn codec_select(env: napi.Env, handle: u64) !bool {
    _ = env;
    const peer = handles.resolve(handle) orelse return false;
    return peer.select();
}

/// The selected event as `[kind, code, payload]`, with the payload copied into a
/// JavaScript-owned buffer.
///
/// The copy is the whole point: the payload borrows a buffer inside the codec that
/// the next frame overwrites, so a `Buffer` handed out has to be the only copy or a
/// listener that retains it would read the next message's bytes.
pub fn codec_event(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(handle) orelse return null;
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

/// Retires the selected event and frees its slot.
pub fn codec_take(env: napi.Env, handle: u64) !void {
    _ = env;
    const peer = handles.resolve(handle) orelse return;
    peer.take();
}

/// The fragment boundaries of the selected data message, ascending.
///
/// Read between `codec_event` and `codec_take`, which is the only window in which the
/// reassembly buffer is still the message the caller is holding. Empty for anything
/// that is not a data message, and for a message that arrived whole, because a
/// single fragment has no interior boundary to report.
///
/// Copied out for the same reason the payload is: the boundaries live in codec memory
/// that the next message overwrites, and a caller that retained the view would read
/// the next message's offsets.
pub fn codec_fragments(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(handle) orelse return null;
    const ends = peer.fragment_ends();
    if (ends.len < 2) return null;
    const array = try env.createArrayWithLength(@intCast(ends.len));
    for (ends, 0..) |end, index| {
        try array.setElement(env, @intCast(index), try env.createUint32(end));
    }
    return array;
}

/// Drops every buffered byte and event, for a connection being abandoned without
/// a close handshake. Belongs here rather than with either direction because it
/// touches both: a half-received frame and a formatted outbound frame are the same
/// slot's state.
pub fn codec_reset(env: napi.Env, handle: u64) !void {
    _ = env;
    const peer = handles.resolve(handle) orelse return;
    peer.reset();
}
