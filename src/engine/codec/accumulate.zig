//! Copying a peer's bytes into the reassembly buffer.
//!
//! Split out of `receive.zig` because it is the one part of the inbound path that
//! touches the bytes themselves: unmasking in the caller's buffer, appending to the
//! accumulator, and feeding the UTF-8 validator. `receive.zig` owns the buffers and
//! the state; this owns what happens to an input, and it is the only module in the
//! codec that can raise `PayloadTooLarge` or `InvalidUtf8` from bytes.
//!
//! **The input is scratch.** `zslay` unmasks in place, which is what saves a copy of
//! every byte a client sends, and the engine's own `WebSocket.on_data` does the same
//! over the same primitive so both routes agree. The cost is that a caller must hand
//! over a buffer nothing else reads and must not feed the same bytes twice: after the
//! first pass they are plaintext, and a second pass over a masked frame is invalid
//! UTF-8 by construction.

const zslay = @import("zslay");
const events = @import("events.zig");
const utf8 = @import("utf8.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// Folds `input` into a receive state, stopping when it runs out or is refused.
///
/// `offset` advances past what was taken and comes back unchanged when a frame could
/// not be completed, so the caller knows to re-feed from where it stopped.
pub fn consume(State: type, peer: *State, input: []const u8, offset: *usize) !void {
    const max_message = State.max_message_bytes;
    const decoded = peer.conn.decoded_header orelse return error.ProtocolError;
    // `zslay` ends an over-long frame at `max_frame_len` and reports what it
    // took as a complete frame, so a decoder that only checked the accumulated
    // message would deliver a silently short one. Refused here, before a byte of
    // the payload is copied.
    if (decoded.payload_len > max_message) return error.PayloadTooLarge;
    const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);
    const position = peer.conn.payload_bytes_processed;
    const remaining = decoded.payload_len - position;
    const available: u64 = @intCast(input.len - offset.*);
    const count: usize = @intCast(@min(remaining, available));
    const chunk = input[offset.*..][0..count];

    if (decoded.masking_key) |key| zslay.frame.mask(@constCast(chunk), key, position);
    offset.* += count;
    peer.conn.advance_payload_read(count) catch return error.ProtocolError;

    if (opcode.is_control()) {
        const start: usize = @intCast(position);
        @memcpy(peer.control[start..][0..count], chunk);
        return;
    }
    // The accumulator is reset on the first byte of a new message and nowhere else.
    // Doing it per chunk made every chunk after the first look like a new message
    // starting inside an open one.
    if (opcode != .continuation and position == 0) {
        peer.message_opcode = opcode;
        peer.message_len = 0;
        peer.parts.clear();
        peer.utf8_state = .{};
    }
    if (peer.message_len + count > max_message) return error.PayloadTooLarge;
    @memcpy(peer.message[peer.message_len..][0..count], chunk);
    peer.message_len += count;
    if (peer.message_opcode == .text and peer.validate_utf8) {
        peer.utf8_state = utf8.feed(peer.utf8_state, chunk) orelse return error.InvalidUtf8;
    }
}
