//! The outbound half of the codec boundary. The two directions share only the handle, and
//! keeping them apart is what makes the asymmetry visible: both read a `Uint8Array` without
//! copying, and each side owns the copy it hands back.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");
const encode_header = @import("../codec/encode-header.zig");

/// Formats only the header for a payload the caller will write as its own chunk, and
/// returns its length or a negative encode-failure ordinal. The caller sizes `out`; the
/// codec writes at most `zslay.MaxFrameHeaderLen` bytes. Compression is not offered here:
/// a compressed frame's length is not known until the compressor runs, so `codec_write`
/// owns that case.
pub fn codec_header(
    env: napi.Env,
    handle: u64,
    kind: abi.Arg,
    fin: abi.Arg,
    payload_len: abi.Arg,
    mask_frame: abi.Arg,
    mask: []const u8,
    out: []const u8,
) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.encode_refusal(.stale_handle);
    const wanted = abi.event_kind(kind) orelse return abi.encode_refusal(.unexpected_opcode);
    // The bridge reads a typed array as `[]const u8`; the backing store is the caller's
    // buffer and is written here, which is the whole point of the call.
    const target = @constCast(out);
    return switch (encode_header.format_header(
        peer.tx.role,
        peer.tx.max_message_bytes,
        wanted,
        fin != 0,
        payload_len,
        mask,
        mask_frame != 0,
        target,
    )) {
        .ok => |length| @intCast(length),
        .failed => |failure| abi.encode_refusal(abi.encode_failure(failure)),
    };
}

/// The framed length is returned so the caller can allocate before copying; a negative
/// return is the negated failure ordinal. `compress` is 1 to ask for compression with RSV1
/// set, a request and not a guarantee -- `encode.transmit` declines it for a control frame
/// or a fragment. `mask` empty draws a key in Zig, or it is `ws`'s `generateMask` bytes, and
/// `mask_frame` is 0 for a client that asked for an unmasked frame.
pub fn codec_encode(
    env: napi.Env,
    handle: u64,
    kind: abi.Arg,
    fin: abi.Arg,
    payload: []const u8,
    compress: abi.Arg,
    mask_frame: abi.Arg,
    mask: []const u8,
) !abi.Count {
    const peer = handles.resolve(env.handle, handle) orelse return abi.encode_refusal(.stale_handle);
    const wanted = abi.event_kind(kind) orelse return abi.encode_refusal(.unexpected_opcode);
    return switch (peer.tx.encode(wanted, fin != 0, payload, compress != 0, mask, mask_frame != 0)) {
        .ok => |length| @intCast(length),
        .failed => |failure| abi.encode_refusal(abi.encode_failure(failure)),
    };
}

/// Formats one frame and returns it as a Node-owned buffer in one crossing: the caller
/// allocates nothing before the call and copies nothing after it. A negative return is the
/// negated encode-failure ordinal, on the same convention as `codec_encode`.
pub fn codec_write(
    env: napi.Env,
    handle: u64,
    kind: abi.Arg,
    fin: abi.Arg,
    payload: []const u8,
    compress: abi.Arg,
    mask_frame: abi.Arg,
    mask: []const u8,
) !napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse
        return env.createInt32(abi.encode_refusal(.stale_handle));
    const wanted = abi.event_kind(kind) orelse
        return env.createInt32(abi.encode_refusal(.unexpected_opcode));
    return switch (peer.tx.encode(wanted, fin != 0, payload, compress != 0, mask, mask_frame != 0)) {
        .ok => blk: {
            const bytes = peer.tx.bytes();
            const buffer = try env.createBuffer(bytes.len);
            @memcpy(buffer.data[0..bytes.len], bytes);
            break :blk buffer.val;
        },
        .failed => |failure| env.createInt32(abi.encode_refusal(abi.encode_failure(failure))),
    };
}

/// The framed bytes waiting to be copied out, as a JavaScript-owned buffer.
pub fn codec_outbound(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(env.handle, handle) orelse return null;
    const bytes = peer.tx.bytes();
    const buffer = try env.createBuffer(bytes.len);
    @memcpy(buffer.data[0..bytes.len], bytes);
    return buffer.val;
}

/// Whether the last `codec_encode` produced a masked frame, so a caller can assert the role was honoured.
pub fn codec_outbound_masked(env: napi.Env, handle: u64) !bool {
    const peer = handles.resolve(env.handle, handle) orelse return false;
    return peer.tx.last_was_masked();
}
