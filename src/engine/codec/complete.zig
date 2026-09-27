//! Turning a completed frame into an event, or into nothing.
//!
//! Split from `receive.zig` because the two halves fail differently. Consuming
//! bytes can only fail on a length the codec will not accept, and it does so
//! while the frame is still arriving. Deciding what a frame *meant* can fail for
//! reasons the wire cannot show: a close payload with a reserved code, a text
//! message that ended mid-sequence, a control frame that was fragmented. Keeping
//! the two apart means the error each one raises is the error that actually
//! happened, which is what the close code is derived from.

const zslay = @import("zslay");
const close_payload = @import("close_payload.zig");
const events = @import("events.zig");
const utf8 = @import("utf8.zig");
const receive = @import("receive.zig");

const Kind = events.Kind;

/// What a completed frame can mean: an event, or nothing because the frame was a
/// fragment. A fragment is not a message, so there is nothing to report and the
/// accumulator stays. Named rather than written `!?Decoded` twice, because two
/// spellings of the same shape are two types in Zig.
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
    // A frame with no payload never reached `consume`, so the opcode is recorded
    // here as well. An empty text message is legal and common, and without this it
    // would arrive with no opcode and be refused as a continuation with nothing to
    // continue.
    if (opcode != .continuation) peer.message_opcode = opcode;
    if (!decoded.header.fin) {
        peer.conn.complete_frame();
        return .fragment;
    }

    const message_opcode = peer.message_opcode orelse return error.ProtocolError;
    // A message that ends mid-sequence is invalid even though every byte it did
    // contain was in range, which is the case a validator that only ever checks
    // incoming bytes cannot see.
    if (message_opcode == .text and !utf8.complete(peer.utf8_state)) {
        return error.InvalidUtf8;
    }
    const kind: Kind = if (message_opcode == .text) .text else .binary;
    const payload = peer.message[0..peer.message_len];
    peer.message_len = 0;
    peer.message_opcode = null;
    peer.utf8_state = .{};
    peer.conn.complete_frame();
    return .{ .event = .{ .kind = kind, .payload = payload } };
}

fn finish_control(comptime State: type, peer: *State, opcode: zslay.Opcode, payload_len: u64) !receive.Decoded {
    const payload = peer.control[0..@intCast(payload_len)];
    if (opcode == .close) {
        zslay.frame.validate_close_payload(payload) catch |err| {
            return if (err == error.InvalidUtf8) error.InvalidUtf8 else error.ProtocolError;
        };
    }
    const kind: Kind = if (opcode == .ping) .ping else if (opcode == .pong) .pong else .close;
    peer.conn.complete_frame();
    return .{
        .kind = kind,
        // Only a close payload is split into a code and a reason. A ping and a pong
        // carry their bytes whole, and trimming two off the front of either would
        // deliver a short payload for every frame longer than two bytes.
        .code = if (kind == .close) close_payload.close_code(payload) else 0,
        .payload = if (kind == .close) close_payload.close_reason(payload) else payload,
    };
}
