//! The receive half of the frame codec: bytes in, decoded events out.
//!
//! This owns every byte of per-connection receive state and nothing else. It holds no
//! queue and knows nothing about the caller: `finish` reports what a completed frame
//! meant and the codec in `state.zig` decides what to do with that.
//!
//! The frame state machine is `zslay.Conn`, documented as I/O-agnostic, and the
//! engine's own `WebSocket.on_data` drives the same `Conn` with the same loop, so
//! header parsing and masking come from one implementation on both routes rather than
//! two that have to agree by inspection.

const std = @import("std");
const zslay = @import("zslay");
const events = @import("events.zig");
const complete = @import("complete.zig");
const utf8 = @import("utf8.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;

/// RFC 6455 section 5.5 caps every control frame at 125 bytes, so a ping, pong, or
/// close can never need a larger buffer than this.
pub const control_capacity: usize = 125;

/// What one completed frame meant.
///
/// `payload` borrows this struct's own storage, so it is valid until the next
/// payload is taken. Nothing outside the codec may hold it, and the FFI layer
/// copies it into a Node-owned `Buffer` within the call that reads it, which is
/// what keeps engine memory unreachable from JavaScript.
pub const Decoded = struct {
    kind: Kind,
    /// Close code for a `close` frame, 0 otherwise.
    code: u16 = 0,
    payload: []const u8 = &.{},
    /// Why a `rejected` frame was refused.
    failure: Failure = .protocol_error,
};

/// Per-connection receive state.
///
/// `max_message` is the largest reassembled message the codec will accept and is
/// the only size the caller has to choose; every other buffer follows from it. A
/// peer that sends more is closed with 1009 rather than growing anything, which
/// is the whole reason the buffer is comptime-sized.
pub fn receive(comptime max_message: usize) type {
    if (max_message == 0) @compileError("codec message capacity must be greater than zero");
    if (max_message > std.math.maxInt(u32)) @compileError("codec message capacity must fit a u32 length");

    return struct {
        const Self = @This();
        pub const max_message_bytes = max_message;

        /// The frame state machine: the header buffer, the decoded header, the
        /// payload position, and the fragment accumulator.
        conn: zslay.Conn,

        /// Reassembly buffer for the data message in progress. A fragment is
        /// appended as it arrives rather than copied out and back, so a large
        /// message costs one write.
        message: [max_message]u8 = undefined,
        message_len: usize = 0,
        /// Opcode of the message being reassembled, or null between messages.
        /// `zslay.Conn` tracks the same thing for its own limit checks; this copy
        /// exists because the caller has to be told text from binary, and because
        /// a frame with no payload never reaches the payload path that would
        /// otherwise record it.
        message_opcode: ?zslay.Opcode = null,
        utf8_state: utf8.State = .{},

        /// Control payload. A control frame is never fragmented and never exceeds
        /// 125 bytes, so one buffer serves all three control opcodes.
        control: [control_capacity]u8 = undefined,

        /// Builds receive state for one role. The role decides which masking
        /// discipline is enforced: a server refuses an unmasked frame and a client
        /// refuses a masked one, and getting it backwards means a connection
        /// accepts a stream the RFC says is malformed.
        pub fn init(role: zslay.EndpointRole) Self {
            return .{
                .conn = zslay.Conn.init(&[_]zslay.FrameNode{}, .{
                    .role = role,
                    .max_frame_len = max_message,
                    .max_message_len = max_message,
                }) catch unreachable,
            };
        }

        /// Folds `input` in, returning the next thing the driver has to do.
        ///
        /// A `need_payload` step reports how much it took, and a completed frame
        /// comes back as a `Decoded`. The loop that drives them is in `state.zig`,
        /// because stopping for a full queue is a decision about the caller rather
        /// than about the bytes.
        pub fn consume(self: *Self, input: []const u8, offset: *usize) !void {
            const decoded = self.conn.decoded_header orelse return error.ProtocolError;
            // `zslay` ends an over-long frame at `max_frame_len` and reports what it
            // took as a complete frame, so a decoder that only checked the
            // accumulated message would deliver a silently short one. Refused here,
            // before a byte of the payload is copied.
            if (decoded.payload_len > max_message) return error.PayloadTooLarge;
            const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);
            const position = self.conn.payload_bytes_processed;
            const remaining = decoded.payload_len - position;
            const available: u64 = @intCast(input.len - offset.*);
            const count: usize = @intCast(@min(remaining, available));
            const chunk = input[offset.*..][0..count];

            // In place, so the caller's buffer is scratch. The engine's own
            // `on_data` does the same over the same primitive.
            if (decoded.masking_key) |key| zslay.frame.mask(@constCast(chunk), key, position);
            offset.* += count;
            self.conn.advance_payload_read(count) catch return error.ProtocolError;

            if (opcode.is_control()) {
                const start: usize = @intCast(position);
                @memcpy(self.control[start..][0..count], chunk);
                return;
            }
            // The accumulator is reset on the first byte of a new message and
            // nowhere else. Doing it per chunk made every chunk after the first
            // look like a new message starting inside an open one.
            if (opcode != .continuation and position == 0) {
                self.message_opcode = opcode;
                self.message_len = 0;
                self.utf8_state = .{};
            }
            if (self.message_len + count > max_message) return error.PayloadTooLarge;
            @memcpy(self.message[self.message_len..][0..count], chunk);
            self.message_len += count;
            if (self.message_opcode == .text) {
                self.utf8_state = utf8.feed(self.utf8_state, chunk) orelse return error.InvalidUtf8;
            }
        }

        /// Decides what a completed frame meant.
        pub fn finish(self: *Self) anyerror!complete.Finished {
            return complete.finish(Self, self);
        }

        /// Drops every buffered byte, for a connection being abandoned without a
        /// close handshake.
        pub fn reset(self: *Self) void {
            self.conn.reset_rx();
            self.message_len = 0;
            self.message_opcode = null;
            self.utf8_state = .{};
        }
    };
}
