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
const accumulate = @import("accumulate.zig");
const fragments = @import("fragments.zig");
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
pub fn receive(comptime max_message: usize, comptime max_fragments: usize) type {
    if (max_message == 0) @compileError("codec message capacity must be greater than zero");
    if (max_message > std.math.maxInt(u32)) @compileError("codec message capacity must fit a u32 length");
    if (max_fragments == 0) @compileError("codec needs room for at least one fragment");

    return struct {
        const Self = @This();
        pub const max_message_bytes = max_message;
        pub const max_fragments_per_message = max_fragments;

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

        /// The fragment boundaries of the message in progress, and the text policy.
        /// Both are here rather than beside the buffer they describe because both are
        /// per connection and both are read on the same path; `fragments.zig` owns
        /// the arithmetic and the bound.
        parts: fragments.fragments(max_fragments) = .{},
        /// Whether a text payload is validated as UTF-8 as it arrives.
        ///
        /// `ws` exposes this as `skipUTF8Validation` and the docs are explicit that
        /// it is for a caller who trusts the peer. Validating is the default because
        /// an invalid text message is a protocol fault (1007) and delivering it
        /// anyway hands the application bytes that are not the string they will
        /// decode.
        validate_utf8: bool,

        /// Control payload. A control frame is never fragmented and never exceeds
        /// 125 bytes, so one buffer serves all three control opcodes.
        control: [control_capacity]u8 = undefined,

        /// Builds receive state for one role. The role decides which masking
        /// discipline is enforced: a server refuses an unmasked frame and a client
        /// refuses a masked one, and getting it backwards means a connection
        /// accepts a stream the RFC says is malformed.
        pub fn init(role: zslay.EndpointRole, validate_utf8: bool) Self {
            return .{
                .conn = zslay.Conn.init(&[_]zslay.FrameNode{}, .{
                    .role = role,
                    .max_frame_len = max_message,
                    .max_message_len = max_message,
                }) catch unreachable,
                .validate_utf8 = validate_utf8,
            };
        }

        /// Records where a fragment ended, or reports that the message is split into
        /// more pieces than the bound allows.
        pub fn note_fragment(self: *Self) error{TooManyFragments}!void {
            return self.parts.note(self.message_len);
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
        /// close handshake.
        pub fn reset(self: *Self) void {
            self.conn.reset_rx();
            self.message_len = 0;
            self.message_opcode = null;
            self.parts.clear();
            self.utf8_state = .{};
        }
    };
}
