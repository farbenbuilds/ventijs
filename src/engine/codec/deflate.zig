//! RFC 7692 `permessage-deflate` on the codec route, over the engine's libdeflate.
//!
//! The DEFLATE is the engine's: `uWebZockets.compression_stream` is the same libdeflate
//! the engine route compresses with, so one DEFLATE is in the binary and a message one
//! route compresses is a message the other can read. It is `Format.deflate_raw`, which is
//! permessage-deflate's wire format exactly.
//!
//! What RFC 7692 adds on top is the framing, and that is what this file is. A compressed
//! message's payload is a *non-final* deflate block, but libdeflate only ever writes a
//! final one, so `compress` holds its last octet back and leaves a zero there, and
//! `inflate` restores `00 00 ff ff` plus a final empty block. The pinned engine frames it
//! the same way for the same reason.
//!
//! No context is carried between messages, in either direction. That is legal -- RFC
//! 7692 section 7.1.1.1 lets either end answer `*_no_context_takeover` and `ws` accepts
//! both -- and the only cost is compression ratio, since a carried window needs a
//! streaming codec. The pinned engine declines takeover for the same reason.
//!
//! A compressed message's frames concatenate and are inflated once, at the final
//! fragment, which is why `inflate.zig` accumulates rather than inflating per frame. On
//! the send side `rsv1.may_compress` is the whole of the rule.

const std = @import("std");
const uwz = @import("uWebZockets");
const growth = @import("growth.zig");
const rsv1 = @import("rsv1.zig");

/// The four octets RFC 7692 section 7.2.1 removes from a sync-flushed message: a stored
/// block with `BFINAL = 0` and a length of zero, which carries no data of its own.
pub const sync_flush_tail = [_]u8{ 0x00, 0x00, 0xff, 0xff };

/// A final stored block of length zero, appended so libdeflate has a complete stream.
pub const final_empty_block = [_]u8{ 0x01, 0x00, 0x00, 0xff, 0xff };

/// How many octets the receive side restores: the four RFC 7692 names, plus the five
/// that make the stream complete.
pub const restore_len = sync_flush_tail.len + final_empty_block.len;

/// A frame's payload on the wire, and whether it was compressed.
pub const Wire = struct {
    /// Borrowed from the compressor, or the caller's own slice when uncompressed.
    bytes: []const u8,
    /// Whether RSV1 is set, which is the only case where the two are different pointers.
    compressed: bool,
};

/// A frame's payload, compressed if the frame may carry it.
///
/// The whole outbound decision in one call, so the formatter has no branch to get wrong.
/// A frame that may not be compressed gets its own payload back, which is why the answer
/// is a flag on a pair rather than an optional slice.
pub fn wire(
    compressor: *Compressor,
    payload: []const u8,
    ceiling: usize,
    control: bool,
    fin: bool,
    asked: bool,
) Error!Wire {
    if (!rsv1.may_compress(asked, control, fin)) return .{ .bytes = payload, .compressed = false };
    return .{ .bytes = try compressor.compress(payload, ceiling), .compressed = true };
}

/// The octet that stands in for the one libdeflate did not write, so the receiver's
/// restore lands after a non-final block.
pub const compatibility_byte = [_]u8{0x00};

/// The compression level, matching the engine's own WebSocket route.
pub const level: i32 = 6;
/// Why a message could not be compressed. All become a `Failure` before they reach a caller.
pub const Error = error{ CorruptPayload, TooLarge, OutOfMemory, Overflow };

/// The compressor of one connection, plus the scratch it needs.
///
/// The libdeflate engine is allocated once, on the connection's first compressed
/// message, and reused after it: `init` is the only call that mallocs and `finish` the
/// only one that closes the stream, so reusing means rewinding what a pass leaves behind.
/// The alternative is a malloc and a free on every message a peer compresses.
///
/// Two buffers because the API copies: `write` stages into caller-owned storage, so the
/// message is written into `input` and `finish` writes the compressed form into `output`.
/// That is why the compression decision happens before anything is framed.
pub const Compressor = struct {
    input: growth.buffer(u8) = .{},
    output: growth.buffer(u8) = .{},
    stream: ?uwz.compression_stream.CompressionStream = null,

    /// Releases the scratch and the engine. Called by the codec's own `deinit`.
    pub fn deinit(self: *Compressor) void {
        if (self.stream) |*stream| stream.deinit();
        self.stream = null;
        self.input.deinit();
        self.output.deinit();
    }

    /// Compresses one message, returning the bytes to put in the frame. The slice borrows
    /// `self.output` and is valid until the next call, like the receive path's payloads.
    pub fn compress(self: *Compressor, message: []const u8, ceiling: usize) Error![]const u8 {
        // At least two bytes, because the framing holds one byte back and an empty
        // message is a legal thing to send.
        try self.input.reserve(@max(message.len, 1), ceiling);
        const stream = try self.engine();

        stream.write(message) catch return error.CorruptPayload;
        const bound = try std.math.add(usize, stream.output_bound(), compatibility_byte.len);
        try self.output.reserve(bound, try std.math.add(usize, bound, ceiling));

        // The last octet libdeflate writes closes a final block and RFC 7692 has none, so
        // it is held back and a zero takes its place.
        const room = self.output.items[0 .. self.output.items.len - compatibility_byte.len];
        // A zero-length result is libdeflate saying the output did not fit, against a
        // bound it sized itself, rather than saying the message was empty.
        const closed = stream.finish(room) catch return error.OutOfMemory;
        if (closed.len == 0) return error.CorruptPayload;
        self.output.items[closed.len] = 0;
        return self.output.window(closed.len + compatibility_byte.len);
    }

    /// The engine, built on the connection's first compressed message and rewound here.
    fn engine(self: *Compressor) Error!*uwz.compression_stream.CompressionStream {
        if (self.stream) |*stream| {
            // The stream borrows `input` and `reserve` above may have moved it.
            stream.input = self.input.items;
            stream.input_length = 0;
            stream.closed = false;
            return stream;
        }
        self.stream = uwz.compression_stream.CompressionStream.init(
            .deflate_raw,
            level,
            self.input.items,
        ) catch return error.OutOfMemory;
        return &self.stream.?;
    }
};
