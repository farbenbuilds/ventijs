//! Creating a codec: the two ceilings, the UTF-8 policy, and the role.
//!
//! Split from `codec.ts` because creation is the one call on this boundary that can
//! fail for a reason a caller can act on -- a limit it set is out of range -- and
//! because it is the call whose signature *is* the compatibility contract. Everything
//! else about a codec is fixed once it exists, which is exactly why the ceilings have
//! to be right here.

import { codecLimits } from "./codec-limits";
import { createError } from "../compat/errors";
import { callNative } from "./errors";
import { loadAddon } from "./load";

/// The ceilings and the UTF-8 policy a codec is created with.
///
/// A named record rather than four positional arguments, because three of the four
/// are options a caller reads off a normalized options object, and a positional list
/// is where a swapped pair goes unnoticed.
export type CodecOptions = {
  /// The largest message this codec accepts, in either direction. A peer above it is
  /// closed with 1009 and a local `send` above it reports `ERR_MAX_PAYLOAD`.
  readonly maxPayload: number;
  /// The most fragments one message may be split into. A peer above it is closed with
  /// 1008, which is a policy failure rather than a protocol error: the frames were well
  /// formed and the peer simply split one message into too many pieces.
  readonly maxFragments: number;
  /// False for `skipUTF8Validation`. The codec is the validator, so an option the facade
  /// normalized and did not read left a caller who trusts their own server with a hard
  /// 1007 on a payload `ws` would have delivered mangled.
  readonly validateUtf8: boolean;
  /// Whether the opening handshake negotiated RFC 7692 `permessage-deflate`. The only
  /// thing that may set RSV1, so a codec built without it refuses a compressed frame
  /// with 1002 -- which is what RFC 6455 section 5.2 requires.
  readonly permessageDeflate: boolean;
};

/// Creates a frame codec and returns a generation-checked handle.
///
/// The two ceilings are arguments because they are `ws` options: `maxPayload` and
/// `maxFragments` are per-`WebSocketServer` and per-`WebSocket` values, so two
/// connections in one process have to be able to differ. A codec's buffers are
/// runtime-sized and grow to what a peer actually sends, so accepting a large ceiling
/// costs nothing until the peer earns it -- which is what makes `ws`'s 100 MiB default
/// affordable on a server that also holds hundreds of connections.
///
/// A ceiling above `codecLimits().maxPayloadBytes` is refused with a `RangeError`
/// rather than clamped. Clamping is the failure mode this replaced: a `maxPayload`
/// normalized to 100 MiB, reported on `server.options`, and then quietly not enforced,
/// which is indistinguishable from a bug in the library.
export function createCodec(role: number, options: CodecOptions): bigint {
  const limits = codecLimits();
  assertCeiling("maxPayload", options.maxPayload, limits.maxPayloadBytes);
  assertCeiling("maxFragments", options.maxFragments, limits.maxFragments);
  const addon = loadAddon();
  return callNative(() =>
    addon.codecCreate(
      role,
      options.validateUtf8 ? 1 : 0,
      options.maxPayload,
      options.maxFragments,
      options.permessageDeflate ? 1 : 0,
    ),
  );
}

/// Refuses a ceiling the native boundary could not represent or would not accept.
///
/// Zero passes, because `ws` reads it as "no limit" and `limits.Limits.trust` turns it
/// into the ceiling a codec can actually enforce. Translating it in two places would
/// be two rules; translating it in one place and checking the range here is one rule
/// and one range check.
///
/// The native side repeats the range check, because it is the only place a direct call
/// cannot get past. This one exists to fail with the option's own name in the message,
/// which is the difference between a caller reading `maxPayload must be ...` and a
/// caller reading a native enum ordinal.
function assertCeiling(name: string, value: number, ceiling: number): void {
  if (Number.isSafeInteger(value) && value >= 0 && value <= ceiling) return;
  throw createError(
    "ERR_INVALID_OPTION",
    `ventijs: ${name} must be an integer in [0, ${ceiling}] (received ${String(value)})`,
    RangeError,
  );
}
