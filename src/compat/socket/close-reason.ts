import { MAX_CLOSE_REASON_LENGTH } from "../../protocol/close-codes";
import { createError } from "../errors";

const EMPTY = Buffer.alloc(0);

/// The argument surface `Buffer.byteLength` accepts and measures. It is named
/// rather than inlined because the measure call is a deliberate boundary: an
/// argument outside this surface raises Node's own `ERR_INVALID_ARG_TYPE`, which
/// is what `ws` raises, so the type is the reach of the measurement rather than
/// a promise that the argument is acceptable.
type MeasurableReason = string | NodeJS.ArrayBufferView | ArrayBufferLike;

/// Mirrors `ws` sender argument handling, in `ws`'s order.
///
/// The order is load-bearing and is the shape of `sender.close`: decide there is
/// data at all, measure it, apply the cap, and only then dispatch on the type.
/// Checking the type first inverted the two failure modes. A `Float32Array` of
/// 50 elements is 200 bytes, so `ws` reports the oversized reason as a
/// `RangeError`; this order reported it as a `TypeError` for being the wrong
/// type, and a caller reading only the error class would conclude the argument
/// was acceptable.
///
/// Measuring before copying also bounds the copy. A caller passing a
/// 100 MiB `Uint8Array` gets a `RangeError` without the buffer ever being
/// duplicated.
///
/// The `Uint8Array` guard remains the fix for the uninitialized-memory
/// disclosure advisory GHSA-58qx-3vcg-4xpx. A differently typed array reports an
/// element count smaller than its `byteLength`, so sizing a close frame from
/// `byteLength` would ship unwritten heap bytes. `ws` refuses such a reason;
/// accepting it silently would diverge from the compatibility contract.
///
/// Two divergences from `ws` remain, both deliberate. `null` is treated as an
/// absent reason, where `ws` reads `.length` off it and surfaces a V8-internal
/// `TypeError`; and the length probe is not try/caught, so a throwing getter
/// surfaces exactly as it does upstream.
export function toCloseReason(reason: unknown): Buffer {
  if (reason === undefined) return EMPTY;
  if (reason === null) return EMPTY;
  if (!hasReasonData(reason)) return EMPTY;
  assertReasonLength(Buffer.byteLength(reason as MeasurableReason));
  if (typeof reason === "string") return Buffer.from(reason, "utf8");
  if (reason instanceof Uint8Array) return Buffer.from(reason);
  throw createError(
    "ERR_INVALID_OPTION",
    "Second argument must be a string or a Uint8Array",
    TypeError,
  );
}

/// Matches `ws`'s unguarded `!data.length` probe: only a nonzero numeric
/// `length` counts as reason data, so `42`, `{}`, and a lengthless array-like
/// all read as an absent reason. The property read is deliberately not
/// try/caught, so a throwing getter surfaces exactly as it does upstream.
///
/// The `as` narrows the probe to a named shape rather than reaching into
/// `unknown`; the value stays untrusted because `length` is only ever compared,
/// never called or coerced.
function hasReasonData(reason: unknown): boolean {
  const length: unknown = (reason as { readonly length?: unknown }).length;
  return typeof length === "number" && length > 0;
}

function assertReasonLength(length: number): void {
  if (length <= MAX_CLOSE_REASON_LENGTH) return;
  throw createError(
    "ERR_INVALID_CLOSE_REASON",
    "The message must not be greater than 123 bytes",
    RangeError,
  );
}
