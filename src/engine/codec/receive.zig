//! The receive half of the frame codec: bytes in, decoded events out, no queue, and no
//! knowledge of the caller. The frame state machine is `zslay.Conn`, the engine's own.

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

/// RFC 6455 section 5.5 caps every control frame at 125 bytes.
pub const control_capacity: usize = 125;

/// Distinct from `events.Failure`, because a ceiling nobody has reached is not a fault.
pub const Error = error{OutOfMemory};

/// The ceiling is a runtime value and the message buffer grows to reach it.
pub fn receive() type {
    return struct {
        const Self = @This();

        /// The frame state machine: header buffer, decoded header, payload position, fragment
        /// accumulator. It takes its limits per connection, which is what makes a runtime `maxPayload` possible.
        conn: zslay.Conn,

        /// Reassembly buffer, appended to as a message arrives rather than copied out and back, sized by use.
        message: growth.buffer(u8) = .{},
        /// Opcode of the message being reassembled, or null between messages. `zslay` tracks it
        /// too; this copy is here because an empty frame never reaches the payload path.
        message_opcode: ?zslay.Opcode = null,
        utf8_state: utf8.State = .{},

        /// The fragment boundaries and the text policy; `fragments.zig` owns the arithmetic.
        parts: fragments.fragments = .{},
        /// `ws`'s `skipUTF8Validation`; the default, because an invalid text message is 1007.
        validate_utf8: bool,
        /// A compressed message's frames concatenate in `inflate`, so `message` holds plaintext.
        inflate: inflate.Message,

        /// The ceiling, kept beside the buffer it bounds because `accumulate.zig` compares on every chunk.
        max_message_bytes: usize,
        max_fragments_per_message: usize,

        /// Control payload: one buffer for all three opcodes, and it stays comptime-sized at 125 bytes.
        control: [control_capacity]u8 = undefined,

        /// The role decides the masking discipline -- a server refuses an unmasked frame and a
        /// client a masked one, and getting it backwards accepts a stream the RFC calls malformed.
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

        /// The fragment list is grown lazily, which is why its own `deinit` is the conditional one.
        pub fn deinit(self: *Self) void {
            self.message.deinit();
            self.parts.deinit();
            self.inflate.deinit();
        }

        /// A refusal is returned rather than latched; the driver owns the refusal.
        pub fn inspect_rsv1(self: *Self, first: *u8) ?Failure {
            return self.inflate.inspect(first);
        }

        /// The ceiling is the message cap either way, since a compressed message cannot inflate past it.
        pub fn append(self: *Self, chunk: []const u8) !void {
            if (self.inflate.is_compressed()) {
                try self.inflate.stage(chunk, self.max_message_bytes);
                return;
            }
            try self.message.grow(chunk.len, self.max_message_bytes);
            @memcpy(self.message.tail(chunk.len), chunk);
        }

        pub fn note_fragment(self: *Self) error{ TooManyFragments, OutOfMemory }!void {
            try self.parts.note(self.message.length, self.max_fragments_per_message);
        }

        /// The arithmetic and the refusals are in `accumulate.zig`.
        pub fn consume(self: *Self, input: []const u8, offset: *usize) !void {
            return accumulate.consume(Self, self, input, offset);
        }

        pub fn finish(self: *Self) anyerror!complete.Finished {
            return complete.finish(Self, self);
        }

        /// Drops every buffered byte for a connection abandoned without a close handshake. The
        /// allocations stay: a reset connection is one a codec refused, and the next message would pay twice.
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
