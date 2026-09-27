//! The receive half of the frame codec: bytes in, decoded events out.
//!
//! This owns every byte of per-connection receive state and nothing else. It holds no
//! queue and knows nothing about the caller: `finish` reports what a completed frame
//! meant and the codec in `state.zig` decides what to do with that.
//!
//! The frame state machine is `zslay.Conn`, and the engine's own `WebSocket.on_data`
//! drives the same `Conn` with the same loop, so header parsing and masking come from
//! one implementation on both routes.

const std = @import("std");
const zslay = @import("zslay");
const events = @import("events.zig");
const complete = @import("complete.zig");
const accumulate = @import("accumulate.zig");
const fragments = @import("fragments.zig");
const growth = @import("growth.zig");
const limits = @import("limits.zig");
const utf8 = @import("utf8.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;
pub const Decoded = events.Decoded;

/// RFC 6455 section 5.5 caps every control frame at 125 bytes, so a ping, pong, or
/// close can never need a larger buffer than this.
pub const control_capacity: usize = 125;

/// Why receive state could not be built. Distinct from the protocol refusals in
/// `events.Failure`, because a ceiling nobody has reached yet is not a fault.
pub const Error = error{OutOfMemory};

/// Per-connection receive state.
///
/// The ceiling is a runtime value and the message buffer grows to reach it; `limits.zig`
/// says why the ceiling is per-connection and `growth.zig` says why it grows.
pub fn receive() type {
    return struct {
        const Self = @This();

        /// The frame state machine: the header buffer, the decoded header, the payload
        /// position, and the fragment accumulator. Its limits are the runtime ones,
        /// which is the whole point: `zslay.Conn` takes them per connection, so a
        /// 100 MiB `maxPayload` is a number this connection passes rather than a
        /// constant this build chose.
        conn: zslay.Conn,

        /// Reassembly buffer for the message in progress. A fragment is appended as it
        /// arrives rather than copied out and back, so a large message costs one write.
        /// Sized by use, not by `maxPayload`.
        message: growth.buffer(u8) = .{},
        /// Opcode of the message being reassembled, or null between messages.
        /// `zslay.Conn` tracks the same thing for its own limit checks; this copy
        /// exists because the caller has to be told text from binary, and because
        /// a frame with no payload never reaches the payload path that would
        /// otherwise record it.
        message_opcode: ?zslay.Opcode = null,
        utf8_state: utf8.State = .{},

        /// The fragment boundaries, and the text policy. `fragments.zig` owns the
        /// arithmetic and the bound.
        parts: fragments.fragments = .{},
        /// Whether a text payload is validated as UTF-8 as it arrives. `ws` exposes
        /// this as `skipUTF8Validation` and the docs are explicit that it is for a
        /// caller who trusts the peer. Validating is the default because an invalid
        /// text message is a protocol fault (1007) and delivering it anyway hands the
        /// application bytes that are not the string they will decode.
        validate_utf8: bool,

        /// The per-connection ceiling, kept beside the buffer it bounds because
        /// `accumulate.zig` compares against it on every chunk.
        max_message_bytes: usize,
        max_fragments_per_message: usize,

        /// Control payload. A control frame is never fragmented and never exceeds 125
        /// bytes, so one buffer serves all three control opcodes. Comptime-sized on
        /// purpose: 125 bytes against a message buffer that can be 100 MiB, so making
        /// it growable would buy nothing and cost a branch per frame.
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
                .max_message_bytes = trusted.max_message,
                .max_fragments_per_message = trusted.max_fragments,
            };
        }

        /// Releases the message buffer. The fragment list is grown lazily and so
        /// may never have been allocated, which is why its own `deinit` is
        /// conditional rather than this one.
        pub fn deinit(self: *Self) void {
            self.message.deinit();
            self.parts.deinit();
        }

        /// Records where a fragment ended, or reports the message is split into more
        /// pieces than the bound allows.
        pub fn note_fragment(self: *Self) error{ TooManyFragments, OutOfMemory }!void {
            try self.parts.note(self.message.length, self.max_fragments_per_message);
        }

        /// The fragment boundaries of the message in progress, ascending.
        pub fn fragment_ends(self: *const Self) []const u32 {
            return self.parts.ends();
        }

        /// Forgets the boundaries, for a message that is starting or has ended.
        pub fn clear_fragments(self: *Self) void {
            self.parts.clear();
        }

        /// Folds one input in, advancing `offset` past what it took.
        ///
        /// The arithmetic and the refusals are in `accumulate.zig`; this is the
        /// method the driver calls, so the state type owns its own copy loop.
        pub fn consume(self: *Self, input: []const u8, offset: *usize) !void {
            return accumulate.consume(Self, self, input, offset);
        }

        /// Decides what a completed frame meant.
        pub fn finish(self: *Self) anyerror!complete.Finished {
            return complete.finish(Self, self);
        }

        /// Drops every buffered byte, for a connection being abandoned without a
        /// close handshake. The allocations stay: a connection that is reset and
        /// then fed again is a peer that sent something a codec refused, and
        /// throwing away the buffer it grew to would make the next message pay for
        /// it twice.
        pub fn reset(self: *Self) void {
            self.conn.reset_rx();
            self.message.clear();
            self.message_opcode = null;
            self.parts.clear();
            self.utf8_state = .{};
        }
    };
}
