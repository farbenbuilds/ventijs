//! RFC 7692 `permessage-deflate` on the codec route, over the engine's libdeflate -- the same
//! DEFLATE the engine route uses, so a message one route compresses the other can read.
//! What RFC 7692 adds is framing: a compressed payload is a *non-final* deflate block but
//! libdeflate only writes a final one, so `compress` holds its last octet back and `inflate`
//! restores `00 00 ff ff`. No context is carried between messages, legal under RFC 7692
//! section 7.1.1.1, and the only cost is compression ratio.

const std = @import("std");
const uwz = @import("uWebZockets");
const growth = @import("growth.zig");
const rsv1 = @import("rsv1.zig");

/// The four octets RFC 7692 section 7.2.1 removes: a stored block with `BFINAL = 0` and length zero.
pub const sync_flush_tail = [_]u8{ 0x00, 0x00, 0xff, 0xff };

/// A final stored block of length zero, appended so libdeflate has a complete stream.
pub const final_empty_block = [_]u8{ 0x01, 0x00, 0x00, 0xff, 0xff };

/// The four octets above, plus the five that complete the stream.
pub const restore_len = sync_flush_tail.len + final_empty_block.len;

/// A frame's payload on the wire, and whether it was compressed. `compressed` is the only
/// case where the two fields are different pointers.
pub const Wire = struct {
    /// Borrowed from the compressor, or the caller's own slice when uncompressed.
    bytes: []const u8,
    compressed: bool,
};

/// The whole outbound decision in one call so the formatter has no branch to get wrong;
/// a frame that may not be compressed gets its own payload back, hence a flag on a pair.
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

/// Stands in for the octet libdeflate did not write, so the receiver's restore lands after a non-final block.
pub const compatibility_byte = [_]u8{0x00};

/// The compression level, matching the engine's own WebSocket route.
pub const level: i32 = 6;
/// All of these become a `Failure` before they reach a caller.
pub const Error = error{ CorruptPayload, TooLarge, OutOfMemory, Overflow };

/// The libdeflate engine is allocated once, on the first compressed message: `init` is the
/// only call that mallocs, so reuse rewinds what a pass leaves behind.
pub const Compressor = struct {
    input: growth.buffer(u8) = .{},
    output: growth.buffer(u8) = .{},
    stream: ?uwz.compression_stream.CompressionStream = null,

    pub fn deinit(self: *Compressor) void {
        if (self.stream) |*stream| stream.deinit();
        self.stream = null;
        self.input.deinit();
        self.output.deinit();
    }

    /// The slice borrows `self.output` and is valid until the next call, like receive payloads.
    pub fn compress(self: *Compressor, message: []const u8, ceiling: usize) Error![]const u8 {
        // At least two bytes: the framing holds one byte back and an empty message is legal.
        try self.input.reserve(@max(message.len, 1), ceiling);
        const stream = try self.engine();

        stream.write(message) catch return error.CorruptPayload;
        const bound = try std.math.add(usize, stream.output_bound(), compatibility_byte.len);
        try self.output.reserve(bound, try std.math.add(usize, bound, ceiling));

        // The last octet closes a final block and RFC 7692 has none, so a zero takes its place.
        const room = self.output.items[0 .. self.output.items.len - compatibility_byte.len];
        // A zero-length result means the output did not fit, not that the message was empty.
        const closed = stream.finish(room) catch return error.OutOfMemory;
        if (closed.len == 0) return error.CorruptPayload;
        self.output.items[closed.len] = 0;
        return self.output.window(closed.len + compatibility_byte.len);
    }

    /// Built on the first compressed message and rewound here: the borrow of `input` that
    /// `reserve` may have moved, the write cursor, and the closed flag.
    fn engine(self: *Compressor) Error!*uwz.compression_stream.CompressionStream {
        if (self.stream) |*stream| {
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
