import { MAX_CLOSE_REASON_LENGTH } from "../../protocol/close-codes";
import { createError } from "../errors";

const EMPTY = Buffer.alloc(0);

/// The reach of the measurement, not a promise the argument is acceptable.
type MeasurableReason = string | NodeJS.ArrayBufferView | ArrayBufferLike;

/// `ws`'s sender-argument order: data, measure, cap, then dispatch on type. Type first inverted
/// the failures: a `Float32Array` of 50 is 200 bytes, so `ws` reports a `RangeError`, not a `TypeError`.

// The `Uint8Array` guard fixes GHSA-58qx-3vcg-4xpx: a differently typed array reports fewer
// elements than its `byteLength`, so a frame sized from `byteLength` would ship unwritten heap
// bytes. Two deliberate divergences: `null` is an absent reason, and the probe is not try/caught.
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

/// `ws`'s unguarded `!data.length` probe: only a nonzero numeric `length` counts.
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
