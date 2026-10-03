//! Copying a peer's bytes into the reassembly buffer. `receive.zig` owns the buffers and
//! the state; this owns the input and is the only module that raises `PayloadTooLarge` or
//! `InvalidUtf8` from bytes.
//! The input is read-only: the codec copies into its own buffer and unmasks the copy, so
//! the caller's bytes are never mutated and may be fed again after a resume.

const zslay = @import("zslay");
const uwz = @import("uWebZockets");
const events = @import("events.zig");
const utf8 = @import("utf8.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// `offset` advances past what was taken and stays put when a frame did not complete.
pub fn consume(State: type, peer: *State, input: []const u8, offset: *usize) !void {
    const max_message = peer.max_message_bytes;
    const decoded = peer.conn.decoded_header orelse return error.ProtocolError;
    // A length past the ceiling was already named by `header.inspect`, so this is a backstop.
    if (decoded.payload_len > max_message) return error.PayloadTooLarge;
    const opcode: zslay.Opcode = @enumFromInt(decoded.header.opcode);
    const position = peer.conn.payload_bytes_processed;
    const remaining = decoded.payload_len - position;
    const available: u64 = @intCast(input.len - offset.*);
    const count: usize = @intCast(@min(remaining, available));
    const chunk = input[offset.*..][0..count];

    offset.* += count;
    peer.conn.advance_payload_read(count) catch return error.ProtocolError;

    if (opcode.is_control()) {
        const start: usize = @intCast(position);
        const written = peer.control[start..][0..count];
        @memcpy(written, chunk);
        if (decoded.masking_key) |key| uwz.websocket_mask.apply(written, key, position);
        return;
    }
    // Reset only on the first byte of a message: per chunk it made every later chunk a new one.
    if (opcode != .continuation and position == 0) {
        peer.message_opcode = opcode;
        peer.message.clear();
        peer.parts.clear();
        peer.utf8_state = .{};
    }
    // The one inbound allocation, at most logarithmic over a message, so a peer under
    // `maxPayload` never pays for `maxPayload`; a compressed message is staged, same bound.
    const written = peer.append(chunk) catch |err| {
        return switch (err) {
            error.TooLarge => error.PayloadTooLarge,
            error.OutOfMemory, error.Overflow => error.PayloadTooLarge,
            error.CorruptPayload => error.InvalidUtf8,
        };
    };
    // The mask is applied to the copy, never the caller's bytes, so the plaintext is what
    // the validator below reads and the input may be fed again after a resume.
    if (decoded.masking_key) |key| uwz.websocket_mask.apply(written, key, position);
    // Compressed bytes are not text until inflated, so validation runs at end of message.
    if (!peer.inflate.is_compressed() and peer.message_opcode == .text and peer.validate_utf8) {
        peer.utf8_state = utf8.feed(peer.utf8_state, written) orelse return error.InvalidUtf8;
    }
}
