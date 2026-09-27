//! The codec boundary's vocabulary and numeric widths, in one place.
//!
//! Two things live here because both `codec_io.zig` and `codec_encode.zig` need
//! them and a boundary that defines an ordinal twice defines it wrong once.
//!
//! The widths are not a style choice. napi-zig maps a signed integer wider than 53
//! bits to a JavaScript `bigint` and a narrower one to a `number`, in both
//! directions, so a signature that *looks* interchangeable with another is not: a
//! `u64` handle has to be a `bigint` and a count has to be a `number`. Every count
//! and code on this boundary is a `u32`-range value, so they are `i32`/`u32` here
//! and `number` in `src/binding/native.ts`. Handles are `u64` because they pack an
//! index and a generation into one 64-bit word.

const state = @import("../codec/state.zig");

/// Width of every count, code, and ordinal the boundary returns as a number.
pub const Count = i32;

// A capacity is not a boundary value: a codec has the one capacity the build was
// compiled with, so there is nothing to pass and nothing to check. A per-connection
// `maxPayload` needs a runtime-sized buffer, which is a different codec, not a
// different argument to this one.

/// Width of every argument the boundary reads as a number.
pub const Arg = u32;

/// What a `feed` call did, as the negative it returns. Ordinal 0 is `ok`,
/// reported as a non-negative byte count instead.
pub const Outcome = enum(u8) { backpressure = 1, failed = 2, stale_handle = 3 };

/// Why an `encode` refused, as the negative it returns. Ordinal 0 means no
/// failure, so the members start at 1.
pub const EncodeFailure = enum(u8) {
    unexpected_opcode = 1,
    message_too_large = 2,
    protocol_error = 3,
    stale_handle = 4,
};

/// The ordinal-to-event-kind mapping, so a JavaScript ordinal that is not a kind is
/// a typed refusal rather than a frame with a nonsense opcode.
pub fn event_kind(ordinal: Arg) ?state.Kind {
    if (ordinal > state.max_ordinal) return null;
    return @enumFromInt(@as(u8, @intCast(ordinal)));
}

/// The codec's failure vocabulary onto the boundary's, which is offset by one so
/// that zero can mean "no failure".
///
/// The receive-only failures are listed rather than defaulted. `too_many_fragments` is
/// a decision the receive path makes and `encode` cannot, so naming it says the
/// boundary's writer vocabulary and the parser's are not the same set — which is why
/// `events.Failure` is one enum and this is another.
pub fn encode_failure(failure: state.Failure) EncodeFailure {
    return switch (failure) {
        .unexpected_opcode => .unexpected_opcode,
        .message_too_large, .fragmented_message_too_large => .message_too_large,
        .protocol_error, .reserved_bits, .invalid_utf8 => .protocol_error,
        .too_many_fragments => .protocol_error,
    };
}

/// A `feed` refusal, as the negative ordinal the boundary returns it as.
///
/// The sign is the discriminant: a non-negative return is a byte count and a
/// negative one is the reason the call did not produce one, which is why the
/// ordinals start at 1 and zero is never a refusal. Two functions rather than one
/// over a union of the two vocabularies: `@intFromEnum` over a tagged union reads
/// the *tag*, which is 0 for the first member, so a single union-typed helper
/// silently reported every refusal as "no bytes consumed and no reason".
pub fn feed_refusal(outcome: Outcome) Count {
    return -@as(Count, @intFromEnum(outcome));
}

/// An `encode` refusal, on the same convention as `feed_refusal`.
pub fn encode_refusal(failure: EncodeFailure) Count {
    return -@as(Count, @intFromEnum(failure));
}
