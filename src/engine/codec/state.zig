//! The frame codec: one instance per WebSocket connection, driven by the Node stream that
//! owns the socket. It never sees one, and allocates only when a message outgrows its
//! floor; header parsing, encoding, and masking come from the same `zslay` the engine
//! route uses, so the two routes onto the wire agree by construction.

const zslay = @import("zslay");
const capacities = @import("capacities.zig");
const driver = @import("driver.zig");
const events = @import("events.zig");
const inbound = @import("receive.zig");
const limits = @import("limits.zig");
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

/// A frame codec for one connection. The two ceilings are runtime and the buffers grow
/// to reach them; `control_slots` stays comptime, because a control payload is 125 bytes
/// against a buffer that can be 100 MiB.
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

        /// A ceiling the codec cannot enforce is a configuration error and not a 1009: a
        /// peer did nothing wrong, and closing it for a limit the application chose looks,
        /// from the peer's side, like a bug in the library.
        pub fn init(role: zslay.EndpointRole, trusted: limits.Limits) Error!Self {
            // Sequential so each errdefer is armed before the next fallible call: a failed
            // transmitter build would otherwise leak the receiver's buffer.
            var peer: Self = .{};
            peer.rx = try inbound.receive().init(role, trusted, capacities.message_floor);
            errdefer peer.rx.deinit();
            peer.tx = try framing.transmit().init(role, trusted.max_message);
            errdefer peer.tx.deinit();
            return peer;
        }

        /// Releases every buffer the codec grew. Only the handle table calls it: it is
        /// the only thing that knows a codec is unreachable.
        pub fn deinit(peer: *Self) void {
            peer.rx.deinit();
            peer.tx.deinit();
        }

        /// The fragment boundaries of the data message just delivered, ascending. Read
        /// between `select` and `take`, the only window in which the reassembly buffer is
        /// the caller's message; `binaryType: 'fragments'` slices on it.
        pub fn fragment_ends(peer: *const Self) []const u32 {
            return peer.rx.parts.ends();
        }

        /// Folds `input` into the codec, stopping when the input runs out, the queue fills,
        /// or a frame is refused. `input` is read-only: the codec copies into its own buffer
        /// and unmasks the copy, so the caller's bytes may be fed again after a resume.
        pub fn feed(peer: *Self, input: []const u8) FeedResult {
            return peer.note(driver.feed(Self, peer, input));
        }

        /// Formats one outbound frame. `compress` is the caller's decision -- see
        /// `encode.transmit`, which is where the fragmentation rule lives.
        pub fn encode(peer: *Self, kind: Kind, fin: bool, payload: []const u8, compress: bool) outbound.Encoded {
            return peer.tx.encode(kind, fin, payload, compress);
        }

        pub fn refuse(peer: *Self, failure: Failure) FeedResult {
            return peer.note(driver.refuse(Self, peer, failure));
        }

        /// Records where a fold stopped, so the offset outlives the call.
        fn note(peer: *Self, folded: FeedResult) FeedResult {
            peer.resume_offset = folded.consumed;
            return folded;
        }

        pub fn pending(peer: *const Self) usize {
            return peer.events.pending();
        }

        /// Selects the oldest event, control frames ahead of data messages.
        pub fn select(peer: *Self) bool {
            return peer.events.select();
        }

        pub fn selected_event(peer: *const Self) ?Decoded {
            return peer.events.selected_event();
        }

        pub fn take(peer: *Self) void {
            peer.events.take();
        }

        pub fn pending_failure(peer: *const Self) ?Failure {
            return peer.failure;
        }

        /// The close code a latched failure maps to, or 0 while healthy.
        pub fn failure_code(peer: *const Self) u16 {
            const failure = peer.failure orelse return 0;
            return events.close_code_for(failure);
        }

        /// Where the last fold stopped, for a caller resuming a partial input.
        pub fn resume_at(peer: *const Self) usize {
            return peer.resume_offset;
        }

        pub fn reset(peer: *Self) void {
            peer.rx.reset();
            peer.tx.reset();
            peer.events.reset();
            peer.failure = null;
        }
    };
}
