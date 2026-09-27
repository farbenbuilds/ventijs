//! Shared frame-building fixture for the codec tests.
//!
//! The decoder tests build frames here rather than through the codec's own
//! encoder. A decoder tested with its matching encoder agrees with a
//! symmetrically wrong pair, so the expected outcome of a decode has to come from
//! RFC 6455 and the bytes have to be built independently of the code under test.

const std = @import("std");
const zslay = @import("zslay");
const codec = @import("../../engine/codec/state.zig");

/// The capacity the decode and encode suites share.
pub const codec_type = codec.codec(4096, 8);

/// One frame, built the way a peer would put it on the wire.
pub const Frame = struct {
    fin: bool = true,
    opcode: zslay.Opcode,
    payload: []const u8,
    mask: ?[4]u8 = null,

    pub fn bytes(self: Frame, out: []u8) []const u8 {
        const length: u7 = if (self.payload.len > 65535)
            127
        else if (self.payload.len > 125)
            126
        else
            @intCast(self.payload.len);
        const header: zslay.types.FrameHeader = .{
            .fin = self.fin,
            .rsv1 = false,
            .rsv2 = false,
            .rsv3 = false,
            .opcode = @intFromEnum(self.opcode),
            .mask = self.mask != null,
            .payload_len = length,
        };
        const written = zslay.frame.encode_header(out[0..14], header, self.payload.len, self.mask) catch unreachable;
        @memcpy(out[written..][0..self.payload.len], self.payload);
        if (self.mask) |key| zslay.frame.mask(out[written..][0..self.payload.len], key, 0);
        return out[0 .. written + self.payload.len];
    }
};

/// Writes a frame byte by byte, including ones RFC 6455 forbids.
///
/// `zslay`'s encoder refuses to build an over-long or fragmented control frame,
/// which is correct of it, and several tests are about the decoder refusing what
/// the encoder will not emit. So those bytes are written here instead.
pub fn raw_frame(
    out: []u8,
    fin: bool,
    opcode: u8,
    payload_len: u7,
    masked: bool,
    key: [4]u8,
    payload: []const u8,
) []const u8 {
    const fin_bit: u8 = if (fin) @as(u8, 0x80) else @as(u8, 0);
    const mask_bit: u8 = if (masked) @as(u8, 0x80) else @as(u8, 0);
    out[0] = fin_bit | opcode;
    out[1] = mask_bit | @as(u8, payload_len);
    var written: usize = 2;
    if (masked) {
        @memcpy(out[written..][0..4], &key);
        written += 4;
    }
    for (payload, 0..) |byte, index| {
        out[written + index] = if (masked) byte ^ key[index & 3] else byte;
    }
    return out[0 .. written + payload.len];
}

pub fn server() codec_type {
    return codec_type.init(.server);
}

pub fn client() codec_type {
    return codec_type.init(.client);
}

/// Selects and retires the one event a decode produced, asserting there is
/// exactly one.
pub fn take_only(peer: *codec_type) !codec.Decoded {
    try std.testing.expectEqual(@as(usize, 1), peer.pending());
    try std.testing.expect(peer.select());
    const event = peer.selected_event().?;
    peer.take();
    return event;
}

/// Asserts that nothing is waiting.
pub fn take_none(peer: *codec_type) !void {
    try std.testing.expectEqual(@as(usize, 0), peer.pending());
    try std.testing.expect(!peer.select());
}
