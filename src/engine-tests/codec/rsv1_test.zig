//! What RSV1 means, once `permessage-deflate` is negotiated.
//!
//! Split from `reject_test.zig` because that suite is about what a hostile peer gets and
//! these are about what a *negotiated* peer is allowed: the bit is read rather than
//! refused, the message is latched as compressed, and the two places it is still refused
//! are the ones RFC 6455 names.
//!
//! **The payload is not arbitrary.** A single byte is very often a syntactically valid
//! DEFLATE stream -- `0x79` alone is a fixed-Huffman block that decodes to something -- so
//! a test that fed one byte and expected an inflate failure would be testing libdeflate's
//! tolerance rather than the latch. Eight zero octets cannot be a stream: a stored block
//! needs a length and its one's complement, and `0x0000` is not the complement of
//! `0x0000`. So a refusal here means the bytes went through the codec, not around it.

const std = @import("std");
const testing = std.testing;
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");
const limits = @import("../../engine/codec/limits.zig");
const support = @import("frame_support.zig");

const raw_frame = support.raw_frame;

/// A codec with `permessage-deflate` negotiated, which is the only thing that lets RSV1
/// mean anything.
const Peer = codec.codec(8);

/// A function rather than a module constant because building a codec allocates, and a
/// module-level allocation is a comptime evaluation that cannot run.
fn negotiated() Peer {
    const trusted = limits.Limits.trust(4096, 8, true, true) catch unreachable;
    return Peer.init(.server, trusted) catch unreachable;
}

/// Eight zero octets, which no DEFLATE decoder will accept as a stream.
const NOT_DEFLATE = [_]u8{ 0, 0, 0, 0, 0, 0, 0, 0 };
const KEY = [4]u8{ 1, 2, 3, 4 };

/// Builds a masked frame into `buffer` and returns it with RSV1 set.
///
/// The bit goes in through `buffer` rather than through the slice `raw_frame` hands
/// back, because that slice is const: the frame has to exist before a reserved bit can
/// be placed in its first octet, and the helper writes the octet itself.
fn with_rsv1(buffer: []u8, fin: bool, opcode: zslay.Opcode, payload: []const u8) []const u8 {
    const built = raw_frame(buffer, fin, @intFromEnum(opcode), @intCast(payload.len), true, KEY, payload);
    buffer[0] |= 0x40;
    return buffer[0..built.len];
}

test "a compressed frame has its payload inflated rather than delivered raw" {
    // The proof that the bit was latched: the bytes went through the codec, and a
    // DEFLATE stream they are not is a 1007. Delivered raw they would have been the
    // text "eight zero octets" and the connection would have stayed open.
    var peer = negotiated();
    defer peer.deinit();
    var buffer: [32]u8 = undefined;
    const frame = with_rsv1(&buffer, true, .text, &NOT_DEFLATE);
    _ = peer.feed(frame);
    try testing.expectEqual(codec.Failure.invalid_compressed_data, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1007), peer.failure_code());
}

test "RSV1 on a continuation is ignored, as ws ignores it" {
    // `ws` reads RSV1 only on the first frame of a message, so a continuation's bit
    // carries no meaning. It is still cleared so the header parses, and the message stays
    // as the first frame latched it. The 1007 rather than a 1002 is the assertion: the
    // bit did not become a refusal, the bytes did.
    var peer = negotiated();
    defer peer.deinit();
    var buffer: [32]u8 = undefined;
    const first = with_rsv1(&buffer, false, .text, &NOT_DEFLATE);
    const first_frame = first;
    _ = peer.feed(first_frame);
    try testing.expect(peer.pending_failure() == null);
    const rest = with_rsv1(&buffer, true, .continuation, &NOT_DEFLATE);
    const rest_frame = rest;
    _ = peer.feed(rest_frame);
    try testing.expectEqual(@as(u16, 1007), peer.failure_code());
}

test "a compressed control frame is a protocol error" {
    // Section 5.5: a control frame carries no reserved bits at all, and a peer that
    // sets one is not sending a control frame. This holds even with the extension
    // negotiated, which is the case the bit exists for.
    var peer = negotiated();
    defer peer.deinit();
    var buffer: [32]u8 = undefined;
    const frame = with_rsv1(&buffer, true, .ping, &NOT_DEFLATE);
    _ = peer.feed(frame);
    try testing.expectEqual(codec.Failure.reserved_bits, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1002), peer.failure_code());
}

test "a compressed frame on a codec that negotiated nothing is a protocol error" {
    // The same three cases as above, with the extension absent, and every one of them a
    // 1002 because RSV1 then means nothing at all. `reject_test.zig` pins the first of
    // them; the other two are here because the reason they differ is the negotiation.
    var peer = support.server();
    defer peer.deinit();
    for ([_]zslay.Opcode{ .text, .ping, .continuation }) |opcode| {
        var buffer: [32]u8 = undefined;
        const frame = with_rsv1(&buffer, opcode != .continuation, opcode, &NOT_DEFLATE);
        _ = peer.feed(frame);
        try testing.expect(peer.pending_failure() != null);
    }
}
