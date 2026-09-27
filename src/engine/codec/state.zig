//! The frame codec: one instance per WebSocket connection, driven by the Node
//! stream that owns the socket.
//!
//! The split this module exists for is in
//! `docs/adr/0001-transport-and-framing-ownership.md`. Node owns the transport
//! because a drop-in `ws` replacement has to keep Node's `http.Server` upgrade
//! event, `noServer`, `handleUpgrade`, `shouldHandle`, and the client half, and
//! the pinned engine cannot adopt an already-accepted socket in any case. Zig owns
//! the framing, because header parsing, masking, UTF-8 validation, and
//! fragmentation are where a protocol bug is a memory-safety bug.
//!
//! So this is a parser and a formatter and nothing else. It never sees a socket,
//! a file descriptor, or a Node object, it never allocates on the message path,
//! and every buffer it owns is a comptime-sized array. What it owns is all of the
//! state a connection needs to reassemble a message across reads, validate it
//! incrementally, and refuse the frames RFC 6455 forbids.
//!
//! Four parts, split by responsibility rather than by size: `receive` holds the
//! per-connection receive state, `transmit` formats one complete frame,
//! `events_store` is the bounded store of decoded events, and `driver` is the feed
//! loop that sequences the three. This module is what is left: the type that holds
//! them together, and the surface a caller touches.
//!
//! The header codec itself is not reimplemented. Frame parsing, header encoding,
//! and masking come from the same `zslay` package the engine route uses, so the
//! two routes onto the wire agree by construction rather than by two
//! implementations agreeing by inspection.

const zslay = @import("zslay");
const driver = @import("driver.zig");
const events = @import("events.zig");
const inbound = @import("receive.zig");
const result = @import("feed_result.zig");
const store = @import("events_store.zig");
const transmit = @import("encode.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;
pub const Decoded = inbound.Decoded;
pub const control_capacity = inbound.control_capacity;
pub const header_capacity = transmit.header_capacity;
pub const Encoded = transmit.Encoded;
pub const Outcome = result.Outcome;
pub const FeedResult = result.FeedResult;

/// A frame codec for one connection.
///
/// `max_message` is the largest reassembled message the codec will accept and is
/// the only size the caller has to choose; every other buffer follows from it.
/// `control_slots` is how many control events may wait at once, which is cheap
/// because a control payload is capped at 125 bytes.
pub fn codec(comptime max_message: usize, comptime control_slots: usize) type {
    if (control_slots == 0) @compileError("codec needs at least one control slot");

    return struct {
        const Self = @This();

        pub const max_message_bytes = max_message;

        rx: inbound.receive(max_message) = undefined,
        tx: transmit.transmit(max_message) = undefined,
        events: store.event_store(control_slots) = .{},

        /// Set by the driver when a frame is refused. A failure is latched rather
        /// than returned once, because the connection is finished at that point
        /// and every later call has to report the same reason.
        failure: ?Failure = null,

        /// Builds a codec for one role.
        pub fn init(role: zslay.EndpointRole) Self {
            return .{
                .rx = inbound.receive(max_message).init(role),
                .tx = transmit.transmit(max_message).init(role),
            };
        }

        /// Folds `input` into the codec, stopping when the input runs out, the
        /// event queue fills, or a frame is refused.
        ///
        /// `input` is scratch and is unmasked in place. That is deliberate: it
        /// saves a copy of every byte a client sends, and the engine's own
        /// `WebSocket.on_data` does the same over the same `zslay` primitives, so
        /// both routes agree. The cost is that a caller must hand over a buffer
        /// nothing else reads, and must not re-feed the same bytes twice: after
        /// the first pass they are plaintext, and a second pass over a masked
        /// frame is invalid UTF-8 by construction.
        pub fn feed(self: *Self, input: []const u8) FeedResult {
            return driver.feed(Self, self, input);
        }

        pub fn refuse(self: *Self, failure: Failure) FeedResult {
            return driver.refuse(Self, self, failure);
        }

        /// Events waiting to be taken, including one already selected.
        pub fn pending(self: *const Self) usize {
            return self.events.pending();
        }

        /// Selects the oldest event, control frames ahead of data messages.
        pub fn select(self: *Self) bool {
            return self.events.select();
        }

        pub fn selected_event(self: *const Self) ?Decoded {
            return self.events.selected_event();
        }

        /// Retires the selected event and frees its slot.
        pub fn take(self: *Self) void {
            self.events.take();
        }

        /// Formats one frame and returns its framed length.
        pub fn encode(self: *Self, kind: Kind, fin: bool, payload: []const u8) Encoded {
            return self.tx.encode(kind, fin, payload);
        }

        /// The framed bytes waiting to be copied out.
        pub fn outbound_bytes(self: *const Self) []const u8 {
            return self.tx.bytes();
        }

        /// Whether the last `encode` produced a masked frame, which the caller
        /// needs in order to assert the role was honoured.
        pub fn last_was_masked(self: *const Self) bool {
            return self.tx.last_was_masked();
        }

        /// The latched failure, or null while the connection is healthy.
        pub fn pending_failure(self: *const Self) ?Failure {
            return self.failure;
        }

        /// The close code a latched failure maps to, or 0 while healthy.
        pub fn failure_code(self: *const Self) u16 {
            const failure = self.failure orelse return 0;
            return events.close_code_for(failure);
        }

        /// Drops every buffered byte and event, for a connection being abandoned
        /// without a close handshake.
        pub fn reset(self: *Self) void {
            self.rx.reset();
            self.events.reset();
            self.failure = null;
        }
    };
}
