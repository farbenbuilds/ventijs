//! The event vocabulary a decoded frame turns into.
//!
//! The engine's own `WebSocket` resolves frames into three actions: answer a
//! ping, note a close, or hand a message to the application. The codec needs the
//! same three plus a few the transport does not care about, so the mapping from a
//! completed frame to something the caller can observe is written down once here
//! rather than inline in the state machine.

const zslay = @import("zslay");

/// What a completed frame means to the caller.
///
/// `text` and `binary` are the two halves of a reassembled data message, and
/// `ping`, `pong`, and `close` are the control frames, which RFC 6455 section 5.5
/// permits to be interleaved between the fragments of a data message. The
/// ordinals are the ABI: `src/binding/codec.ts` carries the matching table, so
/// they must keep this order.
pub const Kind = enum(u8) {
    text = 0,
    binary = 1,
    ping = 2,
    pong = 3,
    close = 4,
    /// A frame the codec refused. The connection is finished at that point, but the
    /// event is still queued so a caller has one place to learn why rather than
    /// having to correlate a close code with a timestamp.
    rejected = 5,
};

/// Why a frame could not be accepted, kept apart from `zslay`'s error set so the
/// mapping to a close code is stated in one place rather than at each call site.
pub const Failure = enum(u8) {
    protocol_error,
    unexpected_opcode,
    reserved_bits,
    invalid_utf8,
    message_too_large,
    fragmented_message_too_large,
};

/// The close code a parse failure maps to, per RFC 6455 section 7.4.1.
///
/// The distinction that matters is 1002 against 1007: a frame that violates the
/// framing is a protocol error, and a frame that is well formed but carries
/// invalid UTF-8 is an invalid payload. A codec that collapsed both to 1002 would
/// pass a conformance suite that only checks "an error close happened" and fail
/// one that checks the code, which is what the Autobahn group 7 cases do.
pub fn close_code_for(failure: Failure) u16 {
    return switch (failure) {
        .message_too_large, .fragmented_message_too_large => CLOSE_MESSAGE_TOO_BIG,
        .invalid_utf8 => CLOSE_INVALID_PAYLOAD,
        .protocol_error, .unexpected_opcode, .reserved_bits => CLOSE_PROTOCOL_ERROR,
    };
}

/// The ordinal the FFI reports a failure as, so the boundary does not restate this
/// enum's order and drift from it. Zero is never produced, because a caller has to
/// be able to say "no failure".
pub fn failure_ordinal(failure: Failure) u8 {
    return @intFromEnum(failure) + 1;
}

/// The human-readable reason, for a message the caller can log or send. `ws`
/// sends the empty string for a protocol error and the text for a size error, and
/// the text is the only part a peer ever sees.
pub fn describe(failure: Failure) []const u8 {
    return switch (failure) {
        .invalid_utf8 => "Invalid UTF-8",
        .message_too_large, .fragmented_message_too_large => "Message too large",
        .protocol_error, .unexpected_opcode, .reserved_bits => "Protocol error",
    };
}

/// Whether an opcode may carry a payload of more than 125 bytes.
pub fn is_control(opcode: zslay.Opcode) bool {
    return opcode.is_control();
}

/// Maps a parse failure onto this vocabulary, so the close code is decided in one
/// place rather than at each call site.
///
/// The parameter is `anyerror` rather than `zslay.Error` because each step infers
/// its own error set from the expressions it can actually reach, and Zig does not
/// widen an inferred set to a declared one at a call. The default arm is the
/// policy rather than a gap: an error the codec has no specific reason for is a
/// protocol error as far as the peer is concerned, and 1002 with "Protocol error"
/// is the honest description of a frame it could not accept.
pub fn classify(err: anyerror) Failure {
    return switch (err) {
        error.PayloadTooLarge => .message_too_large,
        error.InvalidUtf8 => .invalid_utf8,
        error.InvalidOpcode => .unexpected_opcode,
        else => .protocol_error,
    };
}

const CLOSE_MESSAGE_TOO_BIG: u16 = 1009;
const CLOSE_INVALID_PAYLOAD: u16 = 1007;
const CLOSE_PROTOCOL_ERROR: u16 = 1002;
