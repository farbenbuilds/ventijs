//! The receive half of RFC 7692: the state of a message that may be compressed. A compressed
//! message's frames concatenate and are inflated once, at the final fragment, which is what
//! `staged` is for: the engine's inflate is one-shot, not streaming. The flag lives here because
//! it is a property of *this* message, latched from the RSV1 bit of its first frame, while
//! whether RSV1 may mean anything is a connection property arriving as `compressible`.
const std = @import("std");
const uwz = @import("uWebZockets");
const deflate = @import("deflate.zig");
const events = @import("events.zig");
const growth = @import("growth.zig");
const capacities = @import("capacities.zig");
const rsv1 = @import("rsv1.zig");

/// `CorruptPayload` is a peer's bytes that are not the message they claimed to be and
/// `TooLarge` is a message over `maxPayload`; both become a `Failure` before a caller.
pub const Error = deflate.Error;
pub const Message = struct {
    /// Latched from the RSV1 bit of the message's first frame.
    compressed: bool = false,
    /// Whether the handshake negotiated `permessage-deflate`, so RSV1 may mean something.
    compressible: bool,

    /// The compressed payload, not yet inflated: one stream split across the frames.
    staged: growth.buffer(u8) = .{},
    /// The stream's own storage, which `write` copies into. Separate from `staged` because
    /// the stream is opened once at the end, so the two cannot be the same memory.
    input: growth.buffer(u8) = .{},
    /// The libdeflate engine, built on the connection's first compressed message and reused
    /// after it, so a peer that compresses every message does not malloc and free an engine
    /// for each one.
    stream: ?uwz.compression_stream.DecompressionStream = null,
    pub fn init(compressible: bool) Message {
        return .{ .compressible = compressible };
    }

    pub fn deinit(message: *Message) void {
        if (message.stream) |*open| open.deinit();
        message.stream = null;
        message.staged.deinit();
        message.input.deinit();
    }

    pub fn is_compressed(message: *const Message) bool {
        return message.compressed;
    }

    /// Latches a compressed message and clears the bit so `zslay` will parse the header. A
    /// refusal is returned rather than latched: the driver owns the refusal.
    pub fn inspect(message: *Message, first: *u8) ?events.Failure {
        return rsv1.inspect(&message.compressed, first, message.compressible);
    }

    pub fn stage(message: *Message, chunk: []const u8, ceiling: usize) Error!void {
        message.staged.grow(chunk.len, ceiling) catch return error.TooLarge;
        @memcpy(message.staged.tail(chunk.len), chunk);
    }

    /// Forgets the message, delivered or refused. The allocations stay: a peer that
    /// compresses one message will compress the next.
    pub fn clear(message: *Message) void {
        message.compressed = false;
        message.staged.clear();
    }

    /// Restores the stripped octets and inflates into `out`, which grows into the ceiling
    /// rather than starting at it: sizing it to `maxPayload` would allocate a connection's
    /// whole 100 MiB default the first time it received a compressed message. A message
    /// that still does not fit at the ceiling is a 1009 rather than a short one.
    pub fn inflate(message: *Message, out: *growth.buffer(u8), ceiling: usize) Error![]const u8 {
        const total = try std.math.add(usize, message.staged.length, deflate.restore_len);
        message.staged.grow(deflate.restore_len, total) catch return error.TooLarge;
        const tail = message.staged.tail(deflate.restore_len);
        @memcpy(tail[0..deflate.sync_flush_tail.len], &deflate.sync_flush_tail);
        @memcpy(tail[deflate.sync_flush_tail.len..], &deflate.final_empty_block);
        try message.input.reserve(total, total);
        const stream = try message.engine();

        stream.write(message.staged.written()) catch return error.TooLarge;
        while (true) {
            if (stream.finish(out.items)) |plain| {
                return plain;
            } else |err| switch (err) {
                // Grow and retry rather than pre-checking the ceiling: libdeflate knows the
                // inflated length and this does not, so asking it sizes the output once.
                error.BufferTooSmall => {
                    const step = try std.math.mul(usize, out.items.len, 2);
                    out.reserve(@max(step, capacities.message_floor), ceiling) catch return error.TooLarge;
                },
                else => return error.CorruptPayload,
            }
        }
    }

    /// A rewind is what a finished pass leaves behind: the borrow of `input`, which
    /// `reserve` may have moved, the write cursor, and the closed flag.
    fn engine(message: *Message) Error!*uwz.compression_stream.DecompressionStream {
        if (message.stream) |*open| {
            open.input = message.input.items;
            open.input_length = 0;
            open.closed = false;
            return open;
        }
        message.stream = uwz.compression_stream.DecompressionStream.init(
            .deflate_raw,
            message.input.items,
        ) catch return error.OutOfMemory;
        return &message.stream.?;
    }
};
