//! The status vocabulary the codec boundary reports in.
//!
//! The ordinals are the ABI, and a caller that wants to handle a refusal reads
//! them from here, so the tables live in one place rather than beside the calls
//! that return them.
//!
//! These are values rather than thrown errors on purpose. The codec runs on the
//! message path, and a throw per refused frame would cost an exception and a stack
//! walk for every frame a hostile peer chose to send, which is the cheapest
//! possible delivery for a denial of service.

/// Which side of the connection enforces masking. A server refuses an unmasked
/// frame and a client refuses a masked one, so getting this backwards means a
/// connection accepts a stream the RFC says is malformed.
export const CODEC_ROLE = {
  client: 0,
  server: 1,
} as const;

export type CodecRole = (typeof CODEC_ROLE)[keyof typeof CODEC_ROLE];

/// What a `feed` call did, mirroring `feed_result.zig`.
export const CODEC_OUTCOME = {
  backpressure: 1,
  failed: 2,
  staleHandle: 3,
} as const;

/// What a completed frame means, mirroring `events.zig`'s `Kind`. The ordinals are
/// the ABI and must keep that order. `continuation` is last on both sides so the six
/// that were there first keep their ordinals.
export const CODEC_KINDS = [
  "text",
  "binary",
  "ping",
  "pong",
  "close",
  "rejected",
  "continuation",
] as const;

export type CodecKindName = (typeof CODEC_KINDS)[number];

/// Why a `feed` refused a frame, mirroring `events.zig`'s `Failure`. The ordinals are
/// the ABI and must keep that order, which is why the Zig side has a test that reads
/// this list's length rather than trusting the two to agree.
///
/// Every member is a condition `ws` names in a `WS_ERR_*` code, plus the two ventijs
/// needs: a refusal with no more specific reason, and a compressed payload that is not
/// a DEFLATE stream.
export const CODEC_FAILURES = [
  "protocolError",
  "expectedFin",
  "expectedMask",
  "invalidCloseCode",
  "invalidControlPayloadLength",
  "invalidOpcode",
  "invalidUtf8",
  "unexpectedMask",
  "unexpectedRsv1",
  "unexpectedRsv2or3",
  "tooManyBufferedParts",
  "unsupportedDataPayloadLength",
  "unsupportedMessageLength",
  "invalidCompressedData",
] as const;

export type CodecFailureName = (typeof CODEC_FAILURES)[number];

/// Why an `encode` refused, mirroring `codec_encode.zig`'s `EncodeFailure`.
export const CODEC_ENCODE_FAILURES = [
  "unexpectedOpcode",
  "messageTooLarge",
  "protocolError",
  "staleHandle",
] as const;

export type CodecEncodeFailure = (typeof CODEC_ENCODE_FAILURES)[number];

/// What one `feed` call did with its input.
///
/// A refusal has no `bytes`: the return's sign is the outcome, so the offset a
/// backpressured input resumes from arrives from `codecFeedResume` instead.
export type FeedOutcome =
  | { readonly kind: "consumed"; readonly bytes: number }
  | { readonly kind: "backpressure" }
  | { readonly kind: "failed" }
  | { readonly kind: "stale-handle" };

/// Decodes the boundary's signed return into a status.
///
/// A non-negative value is a byte count, which is why the two cannot share a
/// single unsigned field: the sign is the whole discriminant.
export function decodeOutcome(value: number): FeedOutcome {
  if (value >= 0) return { kind: "consumed", bytes: value };
  const ordinal = -value;
  if (ordinal === CODEC_OUTCOME.backpressure) return { kind: "backpressure" };
  if (ordinal === CODEC_OUTCOME.failed) return { kind: "failed" };
  return { kind: "stale-handle" };
}
