//! The outbound half of the codec boundary.
//!
//! Split from the inbound half because the two directions have nothing in common
//! but the handle. Inbound hands JavaScript memory to Zig and mutates it while
//! decoding; outbound copies engine memory out and reads the payload without
//! touching it. Keeping them apart is also what makes that asymmetry visible:
//! `ingest` copies because Node-API cannot hand Zig a mutable slice and a `Buffer`
//! the application holds must not be modified, while `codec_encode` reads a
//! `Uint8Array` without copying it at all because nothing modifies it.

const napi = @import("napi-zig");
const abi = @import("codec_abi.zig");
const handles = @import("../codec/handles.zig");

/// Formats one frame and copies it out, reporting the framed length.
///
/// The framed length is returned so the caller can allocate before copying, which
/// is what keeps the header arithmetic out of TypeScript. A negative return is the
/// negated failure ordinal: the caller asked for a frame the codec refuses, and
/// the reason is which failure.
pub fn codec_encode(
    env: napi.Env,
    handle: u64,
    kind: abi.Arg,
    fin: abi.Arg,
    payload: []const u8,
) !abi.Count {
    _ = env;
    const peer = handles.resolve(handle) orelse return abi.encode_refusal(.stale_handle);
    const wanted = abi.event_kind(kind) orelse return abi.encode_refusal(.unexpected_opcode);
    return switch (peer.tx.encode(wanted, fin != 0, payload)) {
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

/// Whether the last `codec_encode` produced a masked frame, so a caller can assert
/// the role was honoured without parsing a header.
pub fn codec_outbound_masked(env: napi.Env, handle: u64) !bool {
    _ = env;
    const peer = handles.resolve(handle) orelse return false;
    return peer.tx.last_was_masked();
}
