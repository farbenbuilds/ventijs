//! The transmit half of the frame codec: one complete frame, formatted. A codec encodes
//! rather than streams, so it holds one frame at a time and the caller allocates the
//! `Buffer` from the length returned here. Masking is decided here and nowhere else,
//! because it is the part a peer can attack: a server must not mask, a client must mask
//! with a fresh key, and that key is the engine's `websocket_mask` primitive.

const std = @import("std");
const zslay = @import("zslay");
const uwz = @import("uWebZockets");
const capacities = @import("capacities.zig");
const events = @import("events.zig");
const growth = @import("growth.zig");
const deflate = @import("deflate.zig");
const header = @import("header.zig");
const outbound = @import("outbound.zig");
const rsv1 = @import("rsv1.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// Longest physical frame header: two base bytes, an eight-byte length, a masking key.
pub const header_capacity: usize = zslay.MaxFrameHeaderLen;

/// Per-connection transmit state. The buffer is sized by the frame being written, not by
/// the ceiling, so a caller sending 40 bytes costs 40 plus a header.
pub fn transmit() type {
    return struct {
        const Self = @This();

        role: zslay.EndpointRole,
        /// Allocated only once a connection actually compresses something.
        compress: deflate.Compressor = .{},

        /// One slot, because a caller encodes, writes, and encodes again.
        buffer: growth.buffer(u8) = .{},
        length: usize = 0,
        masked: bool = false,
        /// The per-connection ceiling, checked before a payload is copied in.
        max_message_bytes: usize,

        pub fn init(role: zslay.EndpointRole, max_message: usize) outbound.Error!Self {
            return .{
                .role = role,
                .buffer = try growth.buffer(u8).init(@min(capacities.outbound_floor, max_message)),
                .max_message_bytes = max_message,
            };
        }

        pub fn deinit(self: *Self) void {
            self.buffer.deinit();
            self.compress.deinit();
        }

        /// `compress` asks for a compressed payload with RSV1 set, honoured only for a
        /// complete data message: RSV1 marks the *first* frame of a message, and a per-frame
        /// deflate stream with no context between frames is not something a receiver can
        /// concatenate. `mask` is `ws`'s `generateMask`: the caller's own four bytes, or empty
        /// to draw one from the operating system. A server never masks either way.
        pub fn encode(self: *Self, kind: Kind, fin: bool, payload: []const u8, compress: bool, mask: []const u8) outbound.Encoded {
            const opcode = header.wire_opcode(kind) orelse return .{ .failed = .invalid_opcode };
            if (payload.len > self.max_message_bytes) return .{ .failed = .unsupported_message_length };
            const control = opcode.is_control();
            // RFC 6455 section 5.5: a control frame is capped at 125 bytes and must not
            // be fragmented, so a caller cannot put an unframable frame on the wire.
            if (control and payload.len > control_capacity) {
                return .{ .failed = .invalid_control_payload_length };
            }
            if (control and !fin) return .{ .failed = .expected_fin };

            // Taken before anything is framed, which is what keeps the frame one contiguous
            // buffer with one header. `ws` decides the same way, in its sender.
            const wire = deflate.wire(&self.compress, payload, self.max_message_bytes, control, fin, compress) catch
                return .{ .failed = .unsupported_message_length };

            const masked = self.role == .client;
            const base: zslay.types.FrameHeader = .{
                .fin = fin,
                .rsv1 = false,
                .rsv2 = false,
                .rsv3 = false,
                .opcode = @intFromEnum(opcode),
                .mask = masked,
                // The framed payload, not `payload`: compression makes the two differ, and the
                // compatibility byte makes them differ by one even when it does not. A length
                // field describing bytes that were never written is a receiver that hangs.
                .payload_len = header.length_field(wire.bytes.len),
            };

            var key: ?zslay.MaskingKey = null;
            if (masked) {
                var chosen: zslay.MaskingKey = undefined;
                if (mask.len == 0) {
                    header.draw_masking_key(&chosen) catch return .{ .failed = .protocol_error };
                } else {
                    if (mask.len != chosen.len) return .{ .failed = .invalid_mask };
                    @memcpy(&chosen, mask);
                }
                key = chosen;
            }
            // One buffer for the whole frame, because the boundary hands JavaScript a single
            // `Buffer` and a caller stitching a header to a payload across the boundary could
            // get the header size wrong.
            const framed = std.math.add(usize, wire.bytes.len, header_capacity) catch {
                return .{ .failed = .unsupported_message_length };
            };
            self.buffer.reserve(framed, self.max_message_bytes + header_capacity) catch {
                return .{ .failed = .unsupported_message_length };
            };
            const written = zslay.frame.encode_header(
                self.buffer.items[0..header_capacity],
                base,
                wire.bytes.len,
                key,
            ) catch return .{ .failed = .protocol_error };
            const start = self.buffer.items[written..][0..wire.bytes.len];
            @memcpy(start, wire.bytes);
            // After the header and before the mask: RSV1 is in the first octet and the
            // mask covers the payload only.
            if (wire.compressed) rsv1.mark(self.buffer.items[0..written]);
            if (key) |drawn| uwz.websocket_mask.apply(start, drawn, 0);
            self.length = written + wire.bytes.len;
            self.masked = masked;
            return .{ .ok = self.length };
        }

        pub fn bytes(self: *const Self) []const u8 {
            return self.buffer.window(self.length);
        }

        /// Whether the last `encode` masked its frame, for a caller asserting the role.
        pub fn last_was_masked(self: *const Self) bool {
            return self.masked;
        }
    };
}

/// RFC 6455 section 5.5, mirrored from `receive.zig` so this path depends on less.
const control_capacity: usize = 125;
