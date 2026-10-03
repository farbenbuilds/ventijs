// The fused feed path: fold bytes and copy the first event into a caller-owned buffer in
// one crossing, with a second call only when a message assembled across reads outgrows the
// buffer the completing read could bound.

import type { NativeCodecInto } from "./native";
import { nativeError } from "./errors";
import { loadAddon } from "./load";

/// The first event a fused feed produced, its payload already copied into the caller's
/// buffer. One crossing replaces feed-then-select-then-copy on the synchronous path.
export type CodecFirst = {
  readonly kindCode: number;
  readonly payload: Buffer;
  readonly ends: readonly number[] | null;
};

/// Folds `bytes` and copies the first event into `out`. Null means the whole input folded
/// with no event, a positive number is the size the event needs, a negative number is a
/// feed refusal, and a tuple is `[kindCode, length, ends?]`.
export function processCodecInto(
  handle: bigint,
  bytes: Uint8Array,
  wantEnds: boolean,
  out: Uint8Array,
): number | NativeCodecInto | null {
  const addon = loadAddon();
  try {
    return addon.codecProcessInto(handle, bytes, wantEnds ? 1 : 0, out);
  } catch (error) {
    throw nativeError(error);
  }
}

/// Copies the selected event into `out` after `processCodecInto` reported it too small.
export function materializeCodec(
  handle: bigint,
  wantEnds: boolean,
  out: Uint8Array,
): number | NativeCodecInto | null {
  const addon = loadAddon();
  try {
    return addon.codecMaterialize(handle, wantEnds ? 1 : 0, out);
  } catch (error) {
    throw nativeError(error);
  }
}
