//! The feed loop: bytes in, decoded events queued, bytes consumed reported.
//!
//! A free function over the codec rather than a method on it, because the loop is a state
//! machine in its own right and the codec is the state it advances. Every iteration must
//! make progress or return, which is what keeps a full queue or a refused frame from
//! becoming a spin.

const zslay = @import("zslay");
const events = @import("events.zig");
const header = @import("header.zig");
const result = @import("feed_result.zig");
const inbound = @import("receive.zig");

/// Runs the loop over one input, reporting what it did.
///
/// `Comptime Codec` is the instantiated codec type, passed rather than imported so this
/// module does not depend on the codec and the codec does not depend on this.
pub fn feed(comptime Codec: type, peer: *Codec, input: []const u8) result.FeedResult {
    if (peer.failure != null) return .{ .consumed = 0, .outcome = .failed };

    var offset: usize = 0;
    while (offset < input.len) {
        const action = peer.rx.conn.advance_rx() catch |err| {
            return peer.refuse(events.classify(err));
        };
        switch (action) {
            .need_header => {
                offset += take_header(Codec, peer, input, offset);
                if (peer.failure != null) return peer.refuse(peer.failure.?);
            },
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

    // A frame that ended exactly on the last byte has a turn left, and the loop above has
    // already consumed its input, so the tail drains here.
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

/// Copies whatever the header still needs, decides what the header says, and returns how
/// much it took. Both decisions read the codec's own copy of the octets, because RSV1 may
/// be cleared in it and a base header may arrive one octet at a time, and `zslay` parses
/// the header on the next `advance_rx`.
fn take_header(comptime Codec: type, peer: *Codec, input: []const u8, offset: usize) usize {
    const destination = peer.rx.conn.get_header_buffer();
    const count = @min(destination.len, input.len - offset);
    @memcpy(destination[0..count], input[offset..][0..count]);
    if (peer.rx.conn.header_bytes_read == 0) {
        if (peer.rx.inspect_rsv1(&destination[0])) |failure| peer.failure = failure;
    }
    peer.rx.conn.advance_header_read(count) catch return 0;
    if (peer.failure == null) inspect_header(Codec, peer);
    return count;
}

/// The faults `zslay` collapses into one error, read from the header it is holding.
///
/// It reports a reserved bit, a fragmented control frame, and an over-long control frame
/// as one `ProtocolError`, and refuses a length over its ceiling before the application
/// can read the number, so a frame nobody could have sent and a frame over `maxPayload`
/// arrive as the same error. One pass per header, two comparisons each.
fn inspect_header(comptime Codec: type, peer: *Codec) void {
    const conn = &peer.rx.conn;
    if (conn.header_bytes_read >= 2) {
        const base = [2]u8{ conn.header_buf[0], conn.header_buf[1] };
        peer.failure = header.base_failure(base, peer.rx.message_opcode != null);
    }
    if (peer.failure != null) return;
    if (conn.header_bytes_read < conn.header_bytes_needed) return;
    const declared = header.declared_length(conn.header_buf[0..conn.header_bytes_needed]) orelse return;
    if (declared > header.max_safe_frame_len) peer.failure = .unsupported_data_payload_length;
}

/// Whether the frame being read has somewhere to go, checked before the payload is
/// copied rather than after: an event's payload is a slice into receive state, so a frame
/// that copies in and then finds the queue full has already overwritten a queued payload.
fn room(comptime Codec: type, peer: *const Codec) bool {
    const decoded = peer.rx.conn.decoded_header orelse return false;
    const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);
    if (opcode.is_control()) return peer.events.has_control_room();
    // A continuation extends a message already being reassembled, so it does not
    // need the message slot until the frame that finishes it.
    return peer.events.has_message_room() or opcode == .continuation;
}

/// What settling one completed frame did. `queued` includes a fragment with nothing to
/// queue; either way the parser has moved on, so the loop is guaranteed to progress.
const Settled = enum { queued, full, failed };

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

/// Latches a failure and reports it as an event where there is room. The parser is
/// reset first, because a refused connection must not keep half a frame's state that a
/// later call could resume from.
pub fn refuse(comptime Codec: type, peer: *Codec, failure: events.Failure) result.FeedResult {
    peer.failure = failure;
    peer.rx.reset();
    // Best effort: the queue may be full, which is exactly the case a latched failure is
    // read through rather than through an event. The payload stays empty because the
    // reason is the ordinal the caller has to ask for anyway.
    if (peer.events.has_control_room()) {
        peer.events.push_control(.{ .kind = .rejected, .failure = failure });
    }
    return .{ .consumed = 0, .outcome = .failed };
}
