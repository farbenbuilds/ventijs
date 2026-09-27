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

const std = @import("std");
const zslay = @import("zslay");
const capacities = @import("capacities.zig");
const events = @import("events.zig");
const growth = @import("growth.zig");
const header = @import("header.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// Longest physical frame header: two base bytes, an eight-byte length, and a
/// four-byte masking key.
pub const header_capacity: usize = zslay.MaxFrameHeaderLen;

/// Why transmit state could not be built. Distinct from `Encoded.failed`, because
/// a codec that could not be built never had a connection to refuse anything on.
pub const Error = error{OutOfMemory};

/// The result of formatting one frame: its length, or why it could not be
/// formatted. Named so the codec and the transmit state agree on one type.
pub const Encoded = union(enum) {
    /// The framed byte count, which is what the caller needs in order to allocate
    /// the buffer it copies into.
    ok: usize,
    failed: Failure,
};

/// Per-connection transmit state.
///
/// The buffer is sized by the frame being written rather than by the ceiling: a caller
/// sending 40 bytes costs 40 bytes plus a header, and a caller who never sends anything
/// costs the opening floor.
pub fn transmit() type {
    return struct {
        const Self = @This();

        role: zslay.EndpointRole,

        /// The formatted frame waiting to be copied out. One slot because a caller
        /// encodes, writes, and encodes again; a caller that needs to interleave two
        /// frames has to drain this one first, which is the rule a single-threaded
        /// writer already follows.
        buffer: growth.buffer(u8) = .{},
        /// The framed length and whether it was masked, reported by `bytes()` and
        /// `last_was_masked()`.
        length: usize = 0,
        masked: bool = false,
        /// The per-connection ceiling, checked before a payload is copied in.
        max_message_bytes: usize,

        pub fn init(role: zslay.EndpointRole, max_message: usize) Error!Self {
            return .{
                .role = role,
                .buffer = try growth.buffer(u8).init(@min(capacities.outbound_floor, max_message)),
                .max_message_bytes = max_message,
            };
        }

        /// Releases the frame buffer.
        pub fn deinit(self: *Self) void {
            self.buffer.deinit();
        }

        /// Formats one frame and returns its length, which is what the caller
        /// needs in order to allocate the buffer it copies into.
        ///
        /// The payload is masked in place for a client, so the bytes handed back
        /// are final and need no second pass.
        pub fn encode(self: *Self, kind: Kind, fin: bool, payload: []const u8) Encoded {
            const opcode = header.wire_opcode(kind) orelse return .{ .failed = .unexpected_opcode };
            if (payload.len > self.max_message_bytes) return .{ .failed = .message_too_large };
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
            // The frame is written whole into one buffer because the boundary hands
            // JavaScript a single `Buffer` of it, and a caller that has to stitch a
            // header to a payload across an FFI call can get the header size wrong.
            // Sizing to the frame rather than to the ceiling is what makes a small
            // message on a 100 MiB connection cheap.
            const framed = std.math.add(usize, payload.len, header_capacity) catch {
                return .{ .failed = .message_too_large };
            };
            self.buffer.reserve(framed, self.max_message_bytes + header_capacity) catch {
                return .{ .failed = .message_too_large };
            };
            const written = zslay.frame.encode_header(
                self.buffer.items[0..header_capacity],
                base,
                payload.len,
                key,
            ) catch return .{ .failed = .protocol_error };
            const start = self.buffer.items[written..][0..payload.len];
            @memcpy(start, payload);
            if (key) |drawn| zslay.frame.mask(start, drawn, 0);
            self.length = written + payload.len;
            self.masked = masked;
            return .{ .ok = self.length };
        }

        /// The framed bytes waiting to be copied out.
        pub fn bytes(self: *const Self) []const u8 {
            return self.buffer.window(self.length);
        }

        /// Whether the last `encode` masked its frame, which the caller needs to assert the
        /// role was honoured.
        pub fn last_was_masked(self: *const Self) bool {
            return self.masked;
        }
    };
}

/// RFC 6455 section 5.5, mirrored from `receive.zig` rather than imported, so the
/// transmit path depends on no module it does not need.
const control_capacity: usize = 125;
