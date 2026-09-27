//! RFC 7692 `permessage-deflate` on the codec route, over the engine's libdeflate.
//!
//! **The DEFLATE is not ours.** `uWebZockets.compression_stream` is the only part of the
//! pinned engine reachable from our Zig that is backed by the same libdeflate the engine
//! route compresses with, and reusing it is the point: one DEFLATE in the binary, and a
//! message one route compresses is a message the other can read. It is
//! `Format.deflate_raw`, which is permessage-deflate's wire format exactly -- RFC 7692 is
//! raw DEFLATE in a frame, not zlib and not gzip.
//!
//! **What RFC 7692 adds is the framing**, and that is what this file is.
//!
//! 1. A compressed message's payload is a *non-final* deflate block, so a receiver that
//!    appends `00 00 ff ff` gets a complete one. libdeflate only ever writes a *final*
//!    block, so `compress` holds its last octet back and puts a zero there: the
//!    `compatibility_byte`. `uWebZockets.ws/deflate.zig` does the same for the same
//!    reason, and reusing its framing rather than deriving a second one is the point of
//!    having one DEFLATE in the binary.
//! 2. libdeflate also wants a final block, so `inflate` appends `00 00 ff ff` *and* a
//!    final empty block, `01 00 00 ff ff`. A decoder that already saw a final block
//!    ignores the rest, which is what makes the restore work for a stream that arrived
//!    with one and for one that did not.
//! 3. Nothing carries across messages. A peer's context takeover is a *choice* and
//!    declining it is always legal: RFC 7692 section 7.1.1.1 lets either end answer with
//!    `server_no_context_takeover` or `client_no_context_takeover`, and `ws` accepts both
//!    unconditionally. The cost is compression ratio, not correctness, and it is the only
//!    cost -- carrying a window across messages needs a streaming codec, and
//!    `compression_stream` is deliberately one-shot.
//!
//! **Fragments.** A compressed message's frames concatenate and are inflated once, at the
//! final fragment, which is why `inflate.zig` accumulates rather than inflating per frame.
//! On the send side `rsv1.may_compress` is the whole of the rule.

const std = @import("std");
const uwz = @import("uWebZockets");
const growth = @import("growth.zig");
const rsv1 = @import("rsv1.zig");

/// The four octets RFC 7692 section 7.2.1 removes from a sync-flushed message: a stored
/// block with `BFINAL = 0` and a length of zero, which carries no data of its own.
pub const sync_flush_tail = [_]u8{ 0x00, 0x00, 0xff, 0xff };

/// A final stored block of length zero, appended so libdeflate has a complete stream.
/// A decoder that reaches a final block stops there, so this is inert for a stream that
/// arrived with one and necessary for a stream that did not.
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

/// The octet that stands in for the one libdeflate did not write.
///
/// One byte, always zero. Its only job is to be there, so that the receiver's restore
/// lands after a non-final block; see `Compressor.compress` for why that is the byte
/// the framing has to hold back.
pub const compatibility_byte = [_]u8{0x00};

/// The compression level, matching the engine's own WebSocket route.
pub const level: i32 = 6;
/// Why a message could not be compressed. The difference that matters at the call site is
/// whose fault each is: `CorruptPayload` is a peer's and `TooLarge` is a peer's, the rest
/// are the process's own. All become a `Failure` before they reach a caller.
pub const Error = error{ CorruptPayload, TooLarge, OutOfMemory, Overflow };

/// The compressor of one connection, plus the scratch it needs.
///
/// The two streams inside `compression_stream` are allocated once and reused for the
/// connection's life, so a steady stream of messages allocates nothing on the message
/// path. The stream itself is one-shot by construction, so each message gets a fresh
/// one over the same input storage and output buffer.
///
/// **Two buffers because the API copies.** `CompressionStream.write` stages what it is
/// given into storage the caller owns, so the message is written into `input` and the
/// stream reads it from there; `finish` then writes the compressed form into `output`.
/// Peak memory for an n-byte message is therefore the message itself, this struct's two
/// buffers, and the output bound, which is the honest cost of a one-shot codec and is
/// why the compression decision happens before anything is framed.
pub const Compressor = struct {
    input: growth.buffer(u8) = .{},
    output: growth.buffer(u8) = .{},

    /// Releases the scratch. Called by the codec's own `deinit`.
    pub fn deinit(self: *Compressor) void {
        self.input.deinit();
        self.output.deinit();
    }

    /// Compresses one message, returning the bytes to put in the frame.
    ///
    /// The returned slice borrows `self.output` and is valid until the next call, which
    /// is the same contract the receive path's event payloads have.
    pub fn compress(self: *Compressor, message: []const u8, ceiling: usize) Error![]const u8 {
        // At least two bytes, because the framing holds one byte back and an empty
        // message is a legal thing to send.
        try self.input.reserve(@max(message.len, 1), ceiling);

        var stream = uwz.compression_stream.CompressionStream.init(
            .deflate_raw,
            level,
            self.input.items,
        ) catch return error.OutOfMemory;
        defer stream.deinit();

        stream.write(message) catch return error.CorruptPayload;
        const bound = try std.math.add(usize, stream.output_bound(), compatibility_byte.len);
        try self.output.reserve(bound, try std.math.add(usize, bound, ceiling));

        // The last octet libdeflate writes closes its *final* block, and RFC 7692 has no
        // final block: a receiver restores `00 00 ff ff` after the payload, so the
        // payload's own tail has to be a non-final block. One byte is held back and a
        // zero takes its place, which is what makes the restored stream both readable
        // and non-final. It is the same framing `uWebZockets.ws/deflate.zig` uses, for
        // the same reason, and reusing it rather than deriving a second one is the point
        // of having one DEFLATE in the binary.
        const room = self.output.items[0 .. self.output.items.len - compatibility_byte.len];
        // A zero-length result is libdeflate's way of saying the output did not fit,
        // and `output_bound` is what it sized against, so it means the bound is wrong
        // rather than that the message was empty.
        const closed = stream.finish(room) catch return error.OutOfMemory;
        if (closed.len == 0) return error.CorruptPayload;
        self.output.items[closed.len] = 0;
        return self.output.window(closed.len + compatibility_byte.len);
    }
};
