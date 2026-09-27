//! The frame codec: one instance per WebSocket connection, driven by the Node
//! stream that owns the socket.
//!
//! `docs/adr/0001-transport-and-framing-ownership.md` records why the framing is
//! here and the transport is not. This is a parser and a formatter: it never sees a
//! socket, never allocates on the message path, and owns only comptime-sized buffers.
//! Each part documents itself — `receive`, `encode`, `events_store`, `driver`,
//! `ingest` — and header parsing, encoding, and masking all come from the same
//! `zslay` the engine route uses, so the two routes onto the wire agree by
//! construction rather than by two implementations agreeing by inspection.

const zslay = @import("zslay");
const driver = @import("driver.zig");
const events = @import("events.zig");
const inbound = @import("receive.zig");
const copy_in = @import("ingest.zig");
const outbound = @import("encode.zig");
const result = @import("feed_result.zig");
const store = @import("events_store.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;
pub const Decoded = inbound.Decoded;
pub const Encoded = outbound.Encoded;
pub const Outcome = result.Outcome;
pub const FeedResult = result.FeedResult;

/// A frame codec for one connection. `max_message` is the largest reassembled message
/// it accepts and the only size a caller chooses; every other buffer follows from it,
/// and `control_slots` is cheap because a control payload is capped at 125 bytes.
pub fn codec(comptime max_message: usize, comptime control_slots: usize) type {
    if (control_slots == 0) @compileError("codec needs at least one control slot");

    return struct {
        const Self = @This();

        pub const max_message_bytes = max_message;

        rx: inbound.receive(max_message) = undefined,
        tx: outbound.transmit(max_message) = undefined,
        events: store.event_store(control_slots) = .{},

        /// Set by the driver when a frame is refused, latched rather than returned
        /// once: the connection is finished, so every later call reports the same reason.
        failure: ?Failure = null,

        /// Where the last `feed` or `ingest` stopped, latched for the same reason. The
        /// boundary reports a refusal as the sign of its return, which leaves no room
        /// in it for the offset, and a caller that cannot resume drops the rest of a
        /// peer's frame.
        resume_offset: usize = 0,

        /// Builds a codec for one role.
        pub fn init(role: zslay.EndpointRole) Self {
            return .{
                .rx = inbound.receive(max_message).init(role),
                .tx = outbound.transmit(max_message).init(role),
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
            return self.note(driver.feed(Self, self, input));
        }

        /// Folds an input the caller must not see modified.
        pub fn ingest(self: *Self, input: []const u8) FeedResult {
            return self.note(copy_in.ingest(Self, self, input));
        }

        /// Latches a failure and reports it as an event where there is room.
        pub fn refuse(self: *Self, failure: Failure) FeedResult {
            return self.note(driver.refuse(Self, self, failure));
        }

        /// Records where a fold stopped, so the offset outlives the call.
        fn note(self: *Self, folded: FeedResult) FeedResult {
            self.resume_offset = folded.consumed;
            return folded;
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

        /// The latched failure, or null while healthy.
        pub fn pending_failure(self: *const Self) ?Failure {
            return self.failure;
        }

        /// The close code a latched failure maps to, or 0 while healthy.
        pub fn failure_code(self: *const Self) u16 {
            const failure = self.failure orelse return 0;
            return events.close_code_for(failure);
        }

        /// Where the last fold stopped, for a caller resuming a partial input.
        pub fn resume_at(self: *const Self) usize {
            return self.resume_offset;
        }

        /// Drops every buffered byte and event, for a connection abandoned early.
        pub fn reset(self: *Self) void {
            self.rx.reset();
            self.events.reset();
            self.failure = null;
        }
    };
}
