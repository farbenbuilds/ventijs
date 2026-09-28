//! The event vocabulary a decoded frame turns into. The engine's own `WebSocket` resolves a
//! frame into three actions -- answer a ping, note a close, hand a message over -- and the
//! codec needs the same three plus a few the transport does not care about.

const zslay = @import("zslay");

/// RFC 6455 section 5.5 lets a peer interleave a control frame between the fragments of
/// one message, which is why the three control opcodes are separate kinds. The ordinals
/// are the ABI: `src/binding/codec-status.ts` carries the matching table, keep this order.
pub const Kind = enum(u8) {
    text = 0,
    binary = 1,
    ping = 2,
    pong = 3,
    close = 4,
    /// A frame the codec refused, still queued so a caller has one place to learn why.
    rejected = 5,
    /// The continuation half of a fragmented outbound message. Last, so the ordinals keep their values.
    continuation = 6,
};

/// One member per condition `ws` names in a `WS_ERR_*` code, plus two of its own. The
/// members are the vocabulary the boundary reports as an ordinal, so
/// `src/binding/codec-status.ts` carries the matching table and the order is the ABI.
pub const Failure = enum(u8) {
    protocol_error,
    expected_fin,
    expected_mask,
    invalid_close_code,
    invalid_control_payload_length,
    invalid_opcode,
    invalid_utf8,
    unexpected_mask,
    unexpected_rsv_1,
    unexpected_rsv_2_3,
    too_many_buffered_parts,
    unsupported_data_payload_length,
    unsupported_message_length,
    /// The one fault with no `ws` equivalent: a compressed payload that is not a DEFLATE
    /// stream, which `ws` reports as a 1007 with no code.
    invalid_compressed_data,
    /// A `generateMask` callback left a buffer that is not four bytes, so there is no key to
    /// mask with. A caller's own mistake, reported on the send callback, so a peer never sees
    /// this close code.
    invalid_mask,
};

/// The close code a parse failure maps to, per RFC 6455 section 7.4.1.
/// A frame that violates the framing is a 1002 protocol error; a well-formed frame
/// carrying invalid UTF-8 or undecodable compressed data is a 1007 invalid payload.
pub fn close_code_for(failure: Failure) u16 {
    return switch (failure) {
        .unsupported_message_length => CLOSE_MESSAGE_TOO_BIG,
        .invalid_utf8, .invalid_compressed_data => CLOSE_INVALID_PAYLOAD,
        .too_many_buffered_parts => CLOSE_POLICY_VIOLATION,
        .protocol_error,
        .expected_fin,
        .expected_mask,
        .invalid_close_code,
        .invalid_control_payload_length,
        .invalid_opcode,
        .unexpected_mask,
        .unexpected_rsv_1,
        .unexpected_rsv_2_3,
        .unsupported_data_payload_length,
        .invalid_mask,
        => CLOSE_PROTOCOL_ERROR,
    };
}

/// The ordinal the FFI reports a failure as, so the boundary need not restate this enum's
/// order and drift from it. Zero is never produced: a caller must be able to say "no failure".
pub fn failure_ordinal(failure: Failure) u8 {
    return @intFromEnum(failure) + 1;
}

/// The highest `Kind` ordinal, which is what the boundary checks against; keep it last.
pub const max_ordinal: u8 = @intFromEnum(Kind.continuation);

pub fn is_control(opcode: zslay.Opcode) bool {
    return opcode.is_control();
}

/// Maps a parse failure onto this vocabulary, so the close code is decided in one place. The
/// default arm is the policy, not a gap: an error the codec cannot name is a protocol error to
/// the peer. The parameter is `anyerror` because Zig will not widen an inferred set to a
/// declared one at a call.
pub fn classify(err: anyerror) Failure {
    return switch (err) {
        error.PayloadTooLarge => .unsupported_message_length,
        error.InvalidUtf8 => .invalid_utf8,
        error.InvalidOpcode => .invalid_opcode,
        error.TooManyFragments => .too_many_buffered_parts,
        error.CorruptPayload => .invalid_compressed_data,
        error.PayloadNotMasked => .expected_mask,
        error.PayloadMasked => .unexpected_mask,
        // The parser's ceiling on a declared length, not `maxPayload`: conflating the
        // two reported a size limit for a length no peer could have sent.
        error.InvalidLength => .unsupported_data_payload_length,
        error.InvalidCloseCode => .invalid_close_code,
        error.InvalidControlPayloadLength => .invalid_control_payload_length,
        else => .protocol_error,
    };
}

const CLOSE_MESSAGE_TOO_BIG: u16 = 1009;
const CLOSE_INVALID_PAYLOAD: u16 = 1007;
const CLOSE_POLICY_VIOLATION: u16 = 1008;
const CLOSE_PROTOCOL_ERROR: u16 = 1002;

/// `payload` borrows the receive state this was decoded into, so it is valid until the next
/// payload is taken. The FFI layer copies it into a Node-owned `Buffer` within the call that
/// reads it, which is what keeps engine memory unreachable from JavaScript.
pub const Decoded = struct {
    kind: Kind,
    code: u16 = 0,
    payload: []const u8 = &.{},
    failure: Failure = .protocol_error,
};
