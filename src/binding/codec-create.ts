/// Creating a codec: the two ceilings, the UTF-8 policy, and the role, whose signature is the
/// compatibility contract.

import { codecLimits } from "./codec-limits";
import { createError } from "../compat/errors";
import { callNative } from "./errors";
import { loadAddon } from "./load";

export type CodecOptions = {
  /// A peer above it is closed with 1009; a local `send` above it reports `ERR_MAX_PAYLOAD`.
  readonly maxPayload: number;
  /// A peer above it is closed with 1008, a policy failure and not a protocol error.
  readonly maxFragments: number;
  /// False for `skipUTF8Validation`: an option the facade normalized and did not read gave a hard 1007 on a payload `ws` would have delivered.
  readonly validateUtf8: boolean;
  /// Whether the handshake negotiated RFC 7692 `permessage-deflate`; without it a compressed frame
  /// is a 1002, as RFC 6455 section 5.2 requires.
  readonly permessageDeflate: boolean;
};

/// A codec's buffers are runtime-sized, so `ws`'s 100 MiB default costs nothing until earned, and a
/// ceiling above the compiled one is refused rather than clamped: a clamped limit is not enforced.
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

/// Zero passes, because `ws` reads it as "no limit" and `limits.Limits.trust` makes it the ceiling.
function assertCeiling(name: string, value: number, ceiling: number): void {
  if (Number.isSafeInteger(value) && value >= 0 && value <= ceiling) return;
  throw createError(
    "ERR_INVALID_OPTION",
    `ventijs: ${name} must be an integer in [0, ${ceiling}] (received ${String(value)})`,
    RangeError,
  );
}
