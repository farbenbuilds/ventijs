//! The outbound half of the codec boundary. The two directions share only the handle, and
//! keeping them apart is what makes the asymmetry visible: `ingest` copies because Node-API
//! cannot hand Zig a mutable slice, while this reads a `Uint8Array` without copying.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// The framed length is returned so the caller can allocate before copying; a negative
/// return is the negated failure ordinal. `compress` is 1 to ask for compression with RSV1
/// set, a request and not a guarantee -- `encode.transmit` declines it for a control frame
/// or a fragment. `mask` empty draws a key in Zig, or it is `ws`'s `generateMask` bytes.
pub fn codec_encode(
    env: napi.Env,
    handle: u64,
    kind: abi.Arg,
    fin: abi.Arg,
    payload: []const u8,
    compress: abi.Arg,
    mask: []const u8,
) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return abi.encode_refusal(.stale_handle);
    const wanted = abi.event_kind(kind) orelse return abi.encode_refusal(.unexpected_opcode);
    return switch (peer.tx.encode(wanted, fin != 0, payload, compress != 0, mask)) {
        .ok => |length| @intCast(length),
        .failed => |failure| abi.encode_refusal(abi.encode_failure(failure)),
    };
}

/// The framed bytes waiting to be copied out, as a JavaScript-owned buffer.
pub fn codec_outbound(env: napi.Env, handle: u64) !?napi.Val {
    const peer = handles.resolve(handle) orelse return null;
    const bytes = peer.tx.bytes();
    const buffer = try env.createBuffer(bytes.len);
    @memcpy(buffer.data[0..bytes.len], bytes);
    return buffer.val;
}

/// Whether the last `codec_encode` produced a masked frame, so a caller can assert the role was honoured.
pub fn codec_outbound_masked(env: napi.Env, handle: u64) !bool {
    _ = env;
    const peer = handles.resolve(handle) orelse return false;
    return peer.tx.last_was_masked();
}
