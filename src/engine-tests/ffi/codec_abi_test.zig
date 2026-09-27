//! The codec boundary's numeric contract.
//!
//! These are the tests for a module that has no logic worth testing on its own and
//! a mistake in it that is invisible from Zig alone. `@intFromEnum` over a tagged
//! union of two vocabularies reads the union's *tag*, not the member's ordinal, so a
//! single union-typed helper reported every refusal as "zero bytes and no reason" and
//! a caller read a full queue as a healthy connection. The mapping is one negated
//! cast per vocabulary, and it is pinned here rather than left to inspection.

const abi = @import("../../engine/ffi/codec_abi.zig");
const events = @import("../../engine/codec/events.zig");
const std = @import("std");
const testing = std.testing;

test "a feed refusal is the negated ordinal" {
    try testing.expectEqual(@as(abi.Count, -1), abi.feed_refusal(.backpressure));
    try testing.expectEqual(@as(abi.Count, -2), abi.feed_refusal(.failed));
    try testing.expectEqual(@as(abi.Count, -3), abi.feed_refusal(.stale_handle));
}

test "an encode refusal is the negated ordinal" {
    try testing.expectEqual(@as(abi.Count, -1), abi.encode_refusal(.unexpected_opcode));
    try testing.expectEqual(@as(abi.Count, -2), abi.encode_refusal(.message_too_large));
    try testing.expectEqual(@as(abi.Count, -3), abi.encode_refusal(.protocol_error));
    try testing.expectEqual(@as(abi.Count, -4), abi.encode_refusal(.stale_handle));
}

test "no ordinal is zero, so a refusal is never a count" {
    // A zero ordinal would make "refused" and "consumed nothing" the same value,
    // which is the one ambiguity the sign is there to remove.
    inline for (@typeInfo(abi.Outcome).@"enum".fields) |field| {
        try testing.expect(field.value != 0);
    }
    inline for (@typeInfo(abi.EncodeFailure).@"enum".fields) |field| {
        try testing.expect(field.value != 0);
    }
}

test "the two vocabularies share ordinals because no call uses both" {
    // `backpressure` and `unexpected_opcode` are both 1, and that is deliberate:
    // `codec_feed` only ever returns the first and `codec_encode` only the second,
    // so a caller reads one table per call. Pinned because the tempting fix, making
    // them globally unique, would spread one enum across two boundaries and make
    // each boundary depend on the other's numbering.
    try testing.expectEqual(
        @intFromEnum(abi.Outcome.backpressure),
        @intFromEnum(abi.EncodeFailure.unexpected_opcode),
    );
}

test "every event kind is sendable and one past the last is refused" {
    // The check is against the *highest* kind, not a named one. It was written against
    // `rejected`, so adding a kind after it produced a kind the boundary refused to
    // send: the refusal was a correct `unexpected_opcode` for an ordinal it considered
    // out of range, and the only symptom was a `send` reporting a protocol error for a
    // frame the caller had explicitly asked for.
    var ordinal: u32 = 0;
    while (ordinal <= events.max_ordinal) : (ordinal += 1) {
        try testing.expect(abi.event_kind(ordinal) != null);
    }
    try testing.expect(abi.event_kind(events.max_ordinal + 1) == null);
}

test "the codec's own failures map onto the boundary's" {
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.protocol_error));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_utf8));
    try testing.expectEqual(abi.EncodeFailure.message_too_large, abi.encode_failure(.message_too_large));
    try testing.expectEqual(abi.EncodeFailure.message_too_large, abi.encode_failure(.fragmented_message_too_large));
    try testing.expectEqual(abi.EncodeFailure.unexpected_opcode, abi.encode_failure(.unexpected_opcode));
}
