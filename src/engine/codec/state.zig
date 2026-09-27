//! The frame codec: one instance per WebSocket connection, driven by the Node stream
//! that owns the socket.
//!
//! `docs/adr/0001-transport-and-framing-ownership.md` records why the framing is here
//! and the transport is not. This is a parser and a formatter: it never sees a socket,
//! and it allocates only when a message outgrows the floor it started at. Header
//! parsing, encoding, and masking all come from the same `zslay` the engine route
//! uses, so the two routes onto the wire agree by construction.

const zslay = @import("zslay");
const capacities = @import("capacities.zig");
const driver = @import("driver.zig");
const events = @import("events.zig");
const inbound = @import("receive.zig");
const limits = @import("limits.zig");
const copy_in = @import("ingest.zig");
const framing = @import("encode.zig");
const outbound = @import("outbound.zig");
const result = @import("feed_result.zig");
const store = @import("events_store.zig");

pub const Kind = events.Kind;
pub const Failure = events.Failure;
pub const max_ordinal = events.max_ordinal;
pub const Decoded = inbound.Decoded;
pub const Outcome = result.Outcome;
pub const FeedResult = result.FeedResult;
pub const Error = error{ CodecTableFull, InvalidMessageCap, InvalidCapacity, OutOfMemory };

/// A frame codec for one connection.
///
/// The two ceilings are runtime and the buffers grow to reach them; `control_slots`
/// stays comptime, because a control payload is 125 bytes against a buffer that can be
/// 100 MiB.
pub fn codec(comptime control_slots: usize) type {
    if (control_slots == 0) @compileError("codec needs at least one control slot");

    return struct {
        const Self = @This();

        rx: inbound.receive() = undefined,
        tx: framing.transmit() = undefined,
        events: store.event_store(control_slots) = .{},

        /// Set by the driver when a frame is refused, latched rather than returned
        /// once: the connection is finished, so every later call reports the same.
        failure: ?Failure = null,

        /// Where the last `feed` or `ingest` stopped. A refusal is the sign of the
        /// boundary's return, leaving no room for the offset.
        resume_offset: usize = 0,

        /// Builds a codec for one role from a trusted limits record, so the table
        /// validates once and every route to a codec is checked once. A ceiling the codec
        /// cannot enforce is a configuration error and not a 1009: a peer did nothing
        /// wrong, and closing it for a limit the application chose looks, from the
        /// peer's side, like a bug in the library.
        pub fn init(role: zslay.EndpointRole, trusted: limits.Limits) Error!Self {
            var self: Self = .{
                .rx = try inbound.receive().init(role, trusted, capacities.message_floor),
                .tx = try framing.transmit().init(role, trusted.max_message),
            };
            errdefer self.rx.deinit();
            errdefer self.tx.deinit();
            return self;
        }

        /// Releases every buffer the codec grew. Only the handle table calls it: it is
        /// the only thing that knows a codec is unreachable.
        pub fn deinit(self: *Self) void {
            self.rx.deinit();
            self.tx.deinit();
        }

        /// The fragment boundaries of the data message just delivered, ascending. Read
        /// between `select` and `take`, the only window in which the reassembly buffer is
        /// the caller's message; `binaryType: 'fragments'` slices on it.
        pub fn fragment_ends(self: *const Self) []const u32 {
            return self.rx.parts.ends();
        }

        /// Folds `input` into the codec, stopping when the input runs out, the queue
        /// fills, or a frame is refused.
        ///
        /// `input` is scratch and is unmasked in place, which saves a copy of every byte
        /// a client sends. The cost is that a caller hands over a buffer nothing else
        /// reads and never re-feeds the same bytes: they are plaintext after.
        pub fn feed(self: *Self, input: []const u8) FeedResult {
            return self.note(driver.feed(Self, self, input));
        }

        pub fn ingest(self: *Self, input: []const u8) FeedResult {
            return self.note(copy_in.ingest(Self, self, input));
        }

        /// Formats one outbound frame. `compress` is the caller's decision -- see
        /// `encode.transmit`, which is where the fragmentation rule lives.
        pub fn encode(self: *Self, kind: Kind, fin: bool, payload: []const u8, compress: bool) outbound.Encoded {
            return self.tx.encode(kind, fin, payload, compress);
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

        pub fn take(self: *Self) void {
            self.events.take();
        }

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

        pub fn reset(self: *Self) void {
            self.rx.reset();
            self.events.reset();
            self.failure = null;
        }
    };
}
