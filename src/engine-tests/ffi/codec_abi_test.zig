//! The codec boundary's numeric contract. `@intFromEnum` over a tagged union of two
//! vocabularies reads the union's tag, so a refusal is one negated cast per vocabulary.

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
    // A zero ordinal would make "refused" and "consumed nothing" the same value.
    inline for (@typeInfo(abi.Outcome).@"enum".fields) |field| {
        try testing.expect(field.value != 0);
    }
    inline for (@typeInfo(abi.EncodeFailure).@"enum".fields) |field| {
        try testing.expect(field.value != 0);
    }
}

test "the two vocabularies share ordinals because no call uses both" {
    // `backpressure` and `unexpected_opcode` are both 1, deliberately: `codec_feed` only
    // ever returns the first and `codec_encode` only the second, so a caller reads one
    // table per call. Making them globally unique would spread one enum across two
    // boundaries, each depending on the other's numbering.
    try testing.expectEqual(
        @intFromEnum(abi.Outcome.backpressure),
        @intFromEnum(abi.EncodeFailure.unexpected_opcode),
    );
}

test "every event kind is sendable and one past the last is refused" {
    // The check is against the *highest* kind, not a named one, so a kind added after it
    // cannot slip past a `send` that reports a protocol error for a requested frame.
    var ordinal: u32 = 0;
    while (ordinal <= events.max_ordinal) : (ordinal += 1) {
        try testing.expect(abi.event_kind(ordinal) != null);
    }
    try testing.expect(abi.event_kind(events.max_ordinal + 1) == null);
}

test "the codec's own failures map onto the boundary's" {
    // Every member is listed rather than defaulted, so adding a failure the writer can hit
    // is a compile error here rather than a `send` reporting a protocol error.
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.protocol_error));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.expected_fin));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.expected_mask));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_close_code));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_control_payload_length));
    try testing.expectEqual(abi.EncodeFailure.unexpected_opcode, abi.encode_failure(.invalid_opcode));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_utf8));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.unexpected_mask));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.unexpected_rsv_1));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.unexpected_rsv_2_3));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.too_many_buffered_parts));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.unsupported_data_payload_length));
    try testing.expectEqual(abi.EncodeFailure.message_too_large, abi.encode_failure(.unsupported_message_length));
    try testing.expectEqual(abi.EncodeFailure.protocol_error, abi.encode_failure(.invalid_compressed_data));
}

test "the failure ordinal the FFI reports is the enum's index plus one" {
    // `src/binding/codec-status.ts` carries the matching table, and the two drift apart
    // silently: the ordinals still work, and every reason is reported as another one.
    try testing.expectEqual(@as(u8, 1), events.failure_ordinal(.protocol_error));
    try testing.expectEqual(@as(u8, 2), events.failure_ordinal(.expected_fin));
    try testing.expectEqual(@as(u8, @intCast(@intFromEnum(events.Failure.invalid_opcode) + 1)), events.failure_ordinal(.invalid_opcode));
    try testing.expectEqual(@as(u8, @intCast(@intFromEnum(events.Failure.invalid_compressed_data) + 1)), events.failure_ordinal(.invalid_compressed_data));
}
