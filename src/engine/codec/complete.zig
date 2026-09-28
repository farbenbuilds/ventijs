//! Turning a completed frame into an event, or into nothing. Deciding what a frame *meant*
//! is kept apart from consuming its bytes so each raises the error that actually happened.

const zslay = @import("zslay");
const close_payload = @import("close_payload.zig");
const events = @import("events.zig");
const utf8 = @import("utf8.zig");
const receive = @import("receive.zig");

const Kind = events.Kind;

/// A fragment is not a message, so nothing is reported and the accumulator stays.
pub const Finished = union(enum) {
    /// A complete data message or control frame.
    event: receive.Decoded,
    /// A fragment. The accumulator stays and no event is produced.
    fragment,
};

/// Decides what a completed frame meant and releases the parser.
pub fn finish(comptime State: type, peer: *State) anyerror!Finished {
    const decoded = peer.conn.decoded_header orelse return error.ProtocolError;
    const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);

    if (opcode.is_control()) return .{ .event = try finish_control(State, peer, opcode, decoded.payload_len) };
    // A frame with no payload never reached `consume`, so the opcode is recorded here too:
    // an empty text message would otherwise arrive with no opcode at all.
    if (opcode != .continuation) peer.message_opcode = opcode;
    if (!decoded.header.fin) {
        // Bound the fragments before the accumulator is released, so a caller that asked
        // for them can slice what was copied. Past the bound this is a policy failure and not
        // a protocol error: RFC 6455 does not forbid splitting a message further.
        peer.note_fragment() catch return error.TooManyFragments;
        peer.conn.complete_frame();
        return .fragment;
    }

    if (peer.inflate.is_compressed()) try decompress(State, peer);
    const message_opcode = peer.message_opcode orelse return error.ProtocolError;
    // A message ending mid-sequence is invalid although every byte was in range, which a
    // byte-wise validator cannot see; this is what `skipUTF8Validation` turns off.
    if (message_opcode == .text and peer.validate_utf8 and !utf8.complete(peer.utf8_state)) {
        return error.InvalidUtf8;
    }
    const kind: Kind = if (message_opcode == .text) .text else .binary;
    const payload = peer.message.written();
    peer.message.clear();
    peer.message_opcode = null;
    peer.utf8_state = .{};
    peer.conn.complete_frame();
    return .{ .event = .{ .kind = kind, .payload = payload } };
}

/// `maxPayload` bounds the *delivered* message, so a peer inflating a small payload to a
/// large one is a 1009 rather than an allocation.
fn decompress(comptime State: type, peer: *State) !void {
    const plain = try peer.inflate.inflate(&peer.message, peer.max_message_bytes);
    peer.message.length = plain.len;
}

/// A control frame is never fragmented and never exceeds 125 bytes, so one buffer serves all three opcodes.
fn finish_control(comptime State: type, peer: *State, opcode: zslay.Opcode, payload_len: u64) !receive.Decoded {
    const payload = peer.control[0..@intCast(payload_len)];
    if (opcode == .close) try validate_close(payload);
    const kind: Kind = if (opcode == .ping) .ping else if (opcode == .pong) .pong else .close;
    peer.conn.complete_frame();
    return .{
        .kind = kind,
        // Only a close payload splits into code and reason; a ping or pong carries its bytes whole.
        .code = if (kind == .close) close_payload.close_code(payload) else 0,
        .payload = if (kind == .close) close_payload.close_reason(payload) else payload,
    };
}

/// The three close-payload faults. `zslay` validates all three but reports two as one
/// `ProtocolError`, so the code check happens here; the order matches `ws`.
fn validate_close(payload: []const u8) !void {
    if (payload.len == 1) return error.ProtocolError;
    if (!close_payload.has_valid_code(payload)) return error.InvalidCloseCode;
    zslay.frame.validate_close_payload(payload) catch |err| {
        return if (err == error.InvalidUtf8) error.InvalidUtf8 else error.ProtocolError;
    };
}
