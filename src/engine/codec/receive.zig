//! The receive half of the frame codec: bytes in, decoded events out.
//!
//! This owns every byte of per-connection receive state and nothing else. It holds no
//! queue and knows nothing about the caller: `finish` reports what a completed frame
//! meant and the codec in `state.zig` decides what to do with that. The frame state
//! machine is `zslay.Conn`, which the engine's own `WebSocket.on_data` drives the same
//! way, so header parsing and masking come from one implementation on both routes.

const std = @import("std");
const zslay = @import("zslay");
const events = @import("events.zig");
const complete = @import("complete.zig");
const accumulate = @import("accumulate.zig");
const fragments = @import("fragments.zig");
const growth = @import("growth.zig");
const inflate = @import("inflate.zig");
const limits = @import("limits.zig");
const utf8 = @import("utf8.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;
pub const Decoded = events.Decoded;

/// RFC 6455 section 5.5 caps every control frame at 125 bytes, so a ping, pong, or
/// close can never need a larger buffer than this.
pub const control_capacity: usize = 125;

/// Why receive state could not be built: distinct from `events.Failure`, because a
/// ceiling nobody has reached yet is not a fault.
pub const Error = error{OutOfMemory};

/// Per-connection receive state. The ceiling is a runtime value and the message buffer
/// grows to reach it; `limits.zig` says why the ceiling is per-connection and
/// `growth.zig` says why it grows.
pub fn receive() type {
    return struct {
        const Self = @This();

        /// The frame state machine: header buffer, decoded header, payload position, and
        /// fragment accumulator. It takes its limits per connection, which is what makes
        /// a runtime `maxPayload` possible at all.
        conn: zslay.Conn,

        /// Reassembly buffer, appended to as a message arrives rather than copied out
        /// and back, so a large message costs one write. Sized by use, not `maxPayload`.
        message: growth.buffer(u8) = .{},
        /// Opcode of the message being reassembled, or null between messages.
        /// `zslay.Conn` tracks it too; this copy is here because the caller has to be
        /// told text from binary, and because an empty frame never reaches the payload
        /// path that would otherwise record it.
        message_opcode: ?zslay.Opcode = null,
        utf8_state: utf8.State = .{},

        /// The fragment boundaries, and the text policy. `fragments.zig` owns the
        /// arithmetic and the bound.
        parts: fragments.fragments = .{},
        /// Whether a text payload is validated as UTF-8 as it arrives, which is `ws`'s
        /// `skipUTF8Validation`. The default, because an invalid text message is 1007.
        validate_utf8: bool,
        /// The message in progress, and whether it arrived compressed. A compressed
        /// message's frames concatenate in `inflate` rather than accumulating here, so
        /// `message` holds plaintext and the UTF-8 validator sees it.
        inflate: inflate.Message,

        /// The per-connection ceiling, kept beside the buffer it bounds because
        /// `accumulate.zig` compares against it on every chunk.
        max_message_bytes: usize,
        max_fragments_per_message: usize,

        /// Control payload. One buffer serves all three control opcodes, and it stays
        /// comptime-sized: 125 bytes against a message buffer that can be 100 MiB.
        control: [control_capacity]u8 = undefined,

        /// Builds receive state for one role from a trusted limits record. The role
        /// decides the masking discipline: a server refuses an unmasked frame and a
        /// client refuses a masked one, and getting it backwards means a connection
        /// accepts a stream the RFC says is malformed.
        pub fn init(role: zslay.EndpointRole, trusted: limits.Limits, floor: usize) Error!Self {
            return .{
                .conn = zslay.Conn.init(&[_]zslay.FrameNode{}, .{
                    .role = role,
                    .max_frame_len = trusted.max_message,
                    .max_message_len = trusted.max_message,
                }) catch unreachable,
                .message = try growth.buffer(u8).init(@min(floor, trusted.max_message)),
                .validate_utf8 = trusted.validate_utf8,
                .inflate = inflate.Message.init(trusted.permessage_deflate),
                .max_message_bytes = trusted.max_message,
                .max_fragments_per_message = trusted.max_fragments,
            };
        }

        /// Releases the message buffer. The fragment list is grown lazily, which is why
        /// its own `deinit` is the conditional one.
        pub fn deinit(self: *Self) void {
            self.message.deinit();
            self.parts.deinit();
            self.inflate.deinit();
        }

        /// Decides what a base header's RSV1 bit means. A refusal is returned rather
        /// than latched; the driver owns the refusal.
        pub fn inspect_rsv1(self: *Self, first: *u8) ?Failure {
            return self.inflate.inspect(first);
        }

        /// Appends a frame's payload: staged for a compressed message, accumulated for
        /// an uncompressed one. The ceiling is the message cap either way, since a
        /// compressed message cannot inflate past it either.
        pub fn append(self: *Self, chunk: []const u8) !void {
            if (self.inflate.is_compressed()) {
                try self.inflate.stage(chunk, self.max_message_bytes);
                return;
            }
            try self.message.grow(chunk.len, self.max_message_bytes);
            @memcpy(self.message.tail(chunk.len), chunk);
        }

        /// Records where a fragment ended, or reports too many pieces.
        pub fn note_fragment(self: *Self) error{ TooManyFragments, OutOfMemory }!void {
            try self.parts.note(self.message.length, self.max_fragments_per_message);
        }

        /// Folds one input in, advancing `offset` past what it took. The arithmetic and
        /// the refusals are in `accumulate.zig`.
        pub fn consume(self: *Self, input: []const u8, offset: *usize) !void {
            return accumulate.consume(Self, self, input, offset);
        }

        /// Decides what a completed frame meant.
        pub fn finish(self: *Self) anyerror!complete.Finished {
            return complete.finish(Self, self);
        }

        /// Drops every buffered byte, for a connection abandoned without a close
        /// handshake. The allocations stay: a reset connection is one a codec refused,
        /// and discarding the buffer it grew to would make the next message pay twice.
        pub fn reset(self: *Self) void {
            self.conn.reset_rx();
            self.message.clear();
            self.message_opcode = null;
            self.parts.clear();
            self.utf8_state = .{};
            self.inflate.clear();
        }
    };
}
