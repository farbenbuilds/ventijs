//! The feed loop: bytes in, decoded events queued, bytes consumed reported.
//!
//! A free function over the codec rather than a method on it, because the loop is
//! a state machine in its own right and the codec is the state it advances. It
//! reads better here than as a hundred-line method: every `advance_rx` action
//! with what each one does, and nothing else in the file.
//!
//! Every iteration must make progress or return. The parser advances on every path
//! through the loop, and a path that cannot advance returns, which is what keeps a
//! full queue or a refused frame from becoming a spin.

const zslay = @import("zslay");
const events = @import("events.zig");
const result = @import("feed_result.zig");
const inbound = @import("receive.zig");

/// Runs the loop over one input, reporting what it did.
///
/// `Comptime Codec` is the instantiated codec type, passed rather than imported
/// so this module does not depend on the codec and the codec does not depend on
/// this. The two are mutually recursive through that parameter, which is why the
/// result type is named here rather than inside the codec.
pub fn feed(comptime Codec: type, peer: *Codec, input: []const u8) result.FeedResult {
    if (peer.failure != null) return .{ .consumed = 0, .outcome = .failed };

    var offset: usize = 0;
    while (offset < input.len) {
        const action = peer.rx.conn.advance_rx() catch |err| {
            return peer.refuse(events.classify(err));
        };
        switch (action) {
            .need_header => offset += take_header(Codec, peer, input, offset),
            .need_payload => {
                if (!room(Codec, peer)) return .{ .consumed = offset, .outcome = .backpressure };
                peer.rx.consume(input, &offset) catch |err| {
                    return peer.refuse(events.classify(err));
                };
            },
            .emit_frame => switch (settle(Codec, peer)) {
                .queued => {},
                .full => return .{ .consumed = offset, .outcome = .backpressure },
                .failed => return peer.refuse(peer.failure.?),
            },
            else => return peer.refuse(.protocol_error),
        }
    }

    // A frame that ended exactly on the last byte has a turn left, and the loop
    // above has already consumed its input, so the tail drains here. A
    // zero-length frame reaches the same place without ever entering the loop.
    while (true) {
        const action = peer.rx.conn.advance_rx() catch |err| {
            return peer.refuse(events.classify(err));
        };
        if (action != .emit_frame) break;
        switch (settle(Codec, peer)) {
            .queued => {},
            .full => return .{ .consumed = offset, .outcome = .backpressure },
            .failed => return peer.refuse(peer.failure.?),
        }
    }
    return .{ .consumed = offset, .outcome = .ok };
}

/// Copies whatever the header still needs and returns how much it took.
///
/// The offset is taken by value and the count returned rather than a pointer being
/// advanced, so the caller's `offset +=` is the only place the cursor moves.
fn take_header(comptime Codec: type, peer: *Codec, input: []const u8, offset: usize) usize {
    const destination = peer.rx.conn.get_header_buffer();
    const count = @min(destination.len, input.len - offset);
    @memcpy(destination[0..count], input[offset..][0..count]);
    peer.rx.conn.advance_header_read(count) catch return 0;
    return count;
}

/// Whether the frame currently being read has somewhere to go.
///
/// Checked before the payload is copied, not after. An event's payload is a slice
/// into receive state, so a frame that copies its bytes in and then finds the
/// queue full has already overwritten a queued event's payload, and the caller
/// would read one message as another.
fn room(comptime Codec: type, peer: *const Codec) bool {
    const decoded = peer.rx.conn.decoded_header orelse return false;
    const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);
    if (opcode.is_control()) return peer.events.has_control_room();
    // A continuation extends a message already being reassembled, so it does not
    // need the message slot until the frame that finishes it.
    return peer.events.has_message_room() or opcode == .continuation;
}

/// What settling one completed frame did.
const Settled = enum {
    /// Queued, or a fragment with nothing to queue. The parser has moved on
    /// either way, so the loop is guaranteed to make progress.
    queued,
    /// The queue is full. The parser has moved on, so the caller can come back
    /// for the rest of its input.
    full,
    /// A frame was refused. The failure is latched on the codec, because three
    /// outcomes of `finish` map onto the same public contract and the loop has to
    /// act on it rather than retry a frame it will never accept.
    failed,
};

/// Turns a completed frame into a queued event.
fn settle(comptime Codec: type, peer: *Codec) Settled {
    const finished = peer.rx.finish() catch |err| {
        peer.failure = events.classify(err);
        return .failed;
    };
    const event = switch (finished) {
        .fragment => return .queued,
        .event => |value| value,
    };
    switch (event.kind) {
        .text, .binary => {
            if (!peer.events.has_message_room()) return .full;
            peer.events.message = event;
        },
        else => {
            if (!peer.events.has_control_room()) return .full;
            peer.events.push_control(event);
        },
    }
    return .queued;
}

/// Latches a failure and reports it as an event where there is room.
///
/// The parser is reset first, because a connection that has been refused must not
/// keep half a frame's worth of state that a later call could resume from.
pub fn refuse(comptime Codec: type, peer: *Codec, failure: events.Failure) result.FeedResult {
    peer.failure = failure;
    peer.rx.reset();
    // Best effort: the queue may be full, which is exactly the case a latched
    // failure is read through rather than through an event.
    if (peer.events.has_control_room()) {
        peer.events.push_control(.{
            .kind = .rejected,
            .failure = failure,
            .payload = events.describe(failure),
        });
    }
    return .{ .consumed = 0, .outcome = .failed };
}
