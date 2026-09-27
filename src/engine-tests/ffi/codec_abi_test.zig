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

test "an ordinal past the last event kind is refused" {
    try testing.expect(abi.event_kind(0) != null);
    try testing.expect(abi.event_kind(@intFromEnum(events.Kind.rejected)) != null);
    try testing.expect(abi.event_kind(@intFromEnum(events.Kind.rejected) + 1) == null);
}

test "the codec's own failures map onto the boundary's" {
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.protocol_error));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_utf8));
    try testing.expectEqual(abi.EncodeFailure.message_too_large, abi.encode_failure(.message_too_large));
    try testing.expectEqual(abi.EncodeFailure.message_too_large, abi.encode_failure(.fragmented_message_too_large));
    try testing.expectEqual(abi.EncodeFailure.unexpected_opcode, abi.encode_failure(.unexpected_opcode));
}
