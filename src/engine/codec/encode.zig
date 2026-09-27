//! The transmit half of the frame codec: one complete frame, formatted.
//!
//! A codec encodes rather than streams, so this holds one formatted frame at a
//! time and hands it over whole. The caller allocates the `Buffer` it copies into
//! from the length this returns, which is what keeps the framing arithmetic out
//! of TypeScript: nothing above this line knows how many bytes a header takes for
//! a given payload, and nothing has to agree with it.
//!
//! The masking discipline is the part a peer can be attacked through, so it is
//! decided here and nowhere else. A server must not mask, because a mask exists
//! to hide a client from a proxy and a server has nothing to hide. A client must
//! mask, with a fresh key drawn from the operating system for every frame. The
//! header layout itself is in `header.zig`.

const zslay = @import("zslay");
const events = @import("events.zig");
const header = @import("header.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// Longest physical frame header: two base bytes, an eight-byte length, and a
/// four-byte masking key.
pub const header_capacity: usize = zslay.MaxFrameHeaderLen;

/// The result of formatting one frame: its length, or why it could not be
/// formatted. Named so the codec and the transmit state agree on one type rather
/// than each spelling an anonymous union.
pub const Encoded = union(enum) {
    /// The framed byte count, which is what the caller needs in order to allocate
    /// the buffer it copies into.
    ok: usize,
    failed: Failure,
};

/// Per-connection transmit state.
pub fn transmit(comptime max_message: usize) type {
    if (max_message == 0) @compileError("codec message capacity must be greater than zero");

    return struct {
        const Self = @This();

        role: zslay.EndpointRole,

        /// The formatted frame waiting to be copied out, and its length. One slot
        /// because a caller encodes, writes, and encodes again; a caller that
        /// needs to interleave two frames has to drain this one first, which is
        /// the rule a single-threaded writer already follows.
        buffer: [max_message + header_capacity]u8 = undefined,
        length: usize = 0,
        masked: bool = false,

        pub fn init(role: zslay.EndpointRole) Self {
            return .{ .role = role };
        }

        /// Formats one frame and returns its length, which is what the caller
        /// needs in order to allocate the buffer it copies into.
        ///
        /// The payload is masked in place for a client, so the bytes handed back
        /// are final and need no second pass.
        pub fn encode(self: *Self, kind: Kind, fin: bool, payload: []const u8) Encoded {
            const opcode = header.wire_opcode(kind) orelse return .{ .failed = .unexpected_opcode };
            if (payload.len > max_message) return .{ .failed = .message_too_large };
            // RFC 6455 section 5.5: a control frame is capped at 125 bytes and
            // must not be fragmented. Both are checked here so a caller cannot
            // put an unframable frame on the wire.
            if (opcode.is_control() and (payload.len > control_capacity or !fin)) {
                return .{ .failed = .protocol_error };
            }

            const masked = self.role == .client;
            const base: zslay.types.FrameHeader = .{
                .fin = fin,
                .rsv1 = false,
                .rsv2 = false,
                .rsv3 = false,
                .opcode = @intFromEnum(opcode),
                .mask = masked,
                .payload_len = header.length_field(payload.len),
            };

            var key: ?zslay.MaskingKey = null;
            if (masked) {
                var drawn: zslay.MaskingKey = undefined;
                header.draw_masking_key(&drawn) catch return .{ .failed = .protocol_error };
                key = drawn;
            }
            const written = zslay.frame.encode_header(
                self.buffer[0..header_capacity],
                base,
                payload.len,
                key,
            ) catch return .{ .failed = .protocol_error };
            const start = self.buffer[written..][0..payload.len];
            @memcpy(start, payload);
            if (key) |drawn| zslay.frame.mask(start, drawn, 0);
            self.length = written + payload.len;
            self.masked = masked;
            return .{ .ok = self.length };
        }

        /// The framed bytes waiting to be copied out.
        pub fn bytes(self: *const Self) []const u8 {
            return self.buffer[0..self.length];
        }

        /// Whether the last `encode` produced a masked frame, which the caller
        /// needs in order to assert the role was honoured.
        pub fn last_was_masked(self: *const Self) bool {
            return self.masked;
        }
    };
}

/// RFC 6455 section 5.5, mirrored from `receive.zig` rather than imported, so
/// the transmit path depends on no module it does not need. One number, and it is
/// the only place a control payload size is written down.
const control_capacity: usize = 125;
