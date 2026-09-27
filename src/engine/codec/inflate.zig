//! The receive half of RFC 7692: the state of a message that may be compressed.
//!
//! Split from `deflate.zig` because the two halves fail differently and are driven from
//! different ends of a frame. The compressor is a decision taken before anything is
//! framed, so it fails as one refusal with one bound. This half is driven by whatever a
//! peer sends, so its two failures are a peer's: bytes that are not the message they
//! claim to be, and a message that outgrows `maxPayload`.
//!
//! **A compressed message's frames concatenate and are inflated once**, at the final
//! fragment, which is what `staged` is for. Inflating per frame would need a streaming
//! inflate to carry state, and the one available is one-shot.
//!
//! The compression flag lives here rather than in `receive.zig` because it is a property
//! of *this* message rather than of the connection: it is latched from the RSV1 bit of
//! the first frame and forgotten when the message is delivered, while whether RSV1 is
//! allowed to mean anything at all is a property of the connection and arrives as
//! `compressible`.

const std = @import("std");
const uwz = @import("uWebZockets");
const deflate = @import("deflate.zig");
const events = @import("events.zig");
const growth = @import("growth.zig");
const capacities = @import("capacities.zig");
const rsv1 = @import("rsv1.zig");

/// Why a compressed message could not be inflated.
///
/// `CorruptPayload` is a 1007: a peer sent bytes that are not the message it said they
/// were. `TooLarge` is a 1009: the message outgrew `maxPayload`. The other two are the
/// process's own. All four become a `Failure` before they reach a caller, which is why
/// the codec's own vocabulary does not have to carry them.
pub const Error = deflate.Error;

/// One message's compression state, and the one inflate that finishes it.
pub const Message = struct {
    /// Whether the message in progress arrived compressed, latched from the RSV1 bit of
    /// its first frame.
    compressed: bool = false,
    /// Whether RSV1 is allowed to mean anything, which is exactly whether the handshake
    /// negotiated `permessage-deflate`. A connection property, kept here because it is
    /// this message's only answer to the question.
    compressible: bool,

    /// The compressed payload, not yet inflated. One stream split across the frames, so
    /// the frames' payloads concatenate and inflate once at the final fragment.
    staged: growth.buffer(u8) = .{},
    /// The stream's own storage, which `write` copies into. A second buffer because the
    /// frames are staged across reads and the stream is opened once at the end, so the
    /// two cannot be the same memory.
    input: growth.buffer(u8) = .{},

    pub fn init(compressible: bool) Message {
        return .{ .compressible = compressible };
    }

    pub fn deinit(self: *Message) void {
        self.staged.deinit();
        self.input.deinit();
    }

    /// Whether the message in progress arrived compressed.
    pub fn is_compressed(self: *const Message) bool {
        return self.compressed;
    }

    /// Decides what a base header's RSV1 bit means, latching a compressed message and
    /// clearing the bit so `zslay` will parse the header. A refusal is returned rather
    /// than latched here, because the driver owns the refusal.
    pub fn inspect(self: *Message, first: *u8) ?events.Failure {
        return rsv1.inspect(&self.compressed, first, self.compressible);
    }

    /// Appends one frame's compressed payload to the message in progress.
    pub fn stage(self: *Message, chunk: []const u8, ceiling: usize) Error!void {
        self.staged.grow(chunk.len, ceiling) catch return error.TooLarge;
        @memcpy(self.staged.tail(chunk.len), chunk);
    }

    /// Forgets the message, delivered or refused. The allocations stay: a peer that
    /// compresses one message will compress the next.
    pub fn clear(self: *Message) void {
        self.compressed = false;
        self.staged.clear();
    }

    /// Restores the stripped octets and inflates into `out`.
    ///
    /// `out` *grows into* the ceiling rather than starting at it. Sizing the output to
    /// `maxPayload` would mean allocating a connection's whole 100 MiB default the first
    /// time it received a compressed message, which is the cost `growth.zig` exists to
    /// avoid; and slicing the reassembly buffer at `ceiling` would be worse, because the
    /// buffer holds a floor, not a ceiling. So libdeflate reports insufficient space,
    /// the output doubles, and the retry is what makes the growth lazy.
    ///
    /// A message that still does not fit at the ceiling is a 1009, delivered as a refusal
    /// rather than as a short message: the same choice `zslay` makes for a frame that
    /// outgrows `max_frame_len`.
    pub fn inflate(self: *Message, out: *growth.buffer(u8), ceiling: usize) Error![]const u8 {
        // The restore octets are appended to what the peer sent rather than assembled
        // into a second buffer, so the compressed form is contiguous once and the
        // stream's own copy is the only duplication.
        const total = try std.math.add(usize, self.staged.length, deflate.restore_len);
        self.staged.grow(deflate.restore_len, total) catch return error.TooLarge;
        const tail = self.staged.tail(deflate.restore_len);
        @memcpy(tail[0..deflate.sync_flush_tail.len], &deflate.sync_flush_tail);
        @memcpy(tail[deflate.sync_flush_tail.len..], &deflate.final_empty_block);
        try self.input.reserve(total, total);

        var stream = uwz.compression_stream.DecompressionStream.init(
            .deflate_raw,
            self.input.items,
        ) catch return error.OutOfMemory;
        defer stream.deinit();

        // `staged` and `input` are separate allocations on purpose: the stream copies
        // what it is given into its own storage, and `@memcpy` on one region into itself
        // is undefined however harmless it looks.
        stream.write(self.staged.written()) catch return error.TooLarge;
        while (true) {
            if (stream.finish(out.items)) |plain| {
                return plain;
            } else |err| switch (err) {
                // One step of growth and another try, rather than a pre-check against
                // the ceiling: libdeflate knows the inflated length and this does not, so
                // asking it is the only way to size the output exactly once.
                error.BufferTooSmall => {
                    const step = try std.math.mul(usize, out.items.len, 2);
                    out.reserve(@max(step, capacities.message_floor), ceiling) catch return error.TooLarge;
                },
                else => return error.CorruptPayload,
            }
        }
    }
};
