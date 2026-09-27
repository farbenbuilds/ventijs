export { CODEC_ENCODE_FAILURES, CODEC_KINDS, CODEC_OUTCOME, CODEC_ROLE } from "./codec-status";
export { createCodec, type CodecOptions } from "./codec-create";

export { codecOutbound, codecOutboundMasked, encodeCodecFrame } from "./codec-encode";
export { codecLimits } from "./codec-limits";
export { codecCeilings, codecFailureCode, codecRole, resetCodec } from "./codec-state";
export type { CodecEncodeFailure, CodecKindName, CodecRole, FeedOutcome } from "./codec-status";

import { CODEC_KINDS, decodeOutcome, type CodecKindName, type FeedOutcome } from "./codec-status";
import type { NativeCodecEvent } from "./native";
import { callNative } from "./errors";
import { loadAddon } from "./load";

/// One decoded frame, copied out of the codec.
export type CodecEvent = {
  readonly kind: CodecKindName;
  /// Close code for a `close` event, 0 otherwise.
  readonly code: number;
  /// For a `close` event this is the reason alone: the two code bytes are not
  /// repeated here, because a caller that got them twice would have to know to have
  /// to strip them.
  readonly payload: Buffer;
};

/// Releases a codec. A stale handle is a no-op rather than an error, because the
/// only way to hold one is to have already released it.
export function destroyCodec(handle: bigint): void {
  const addon = loadAddon();
  callNative(() => addon.codecDestroy(handle));
}

/// Folds bytes into a codec.
///
/// `bytes` is consumed as scratch: the codec unmasked in place, so the same bytes
/// must not be fed twice and a caller that wants them afterwards needs a copy. The
/// returned byte count is where to resume from, because a frame routinely spans
/// reads and a full event store stops the decoder before it finishes the frame.
export function feedCodec(handle: bigint, bytes: Uint8Array): FeedOutcome {
  const addon = loadAddon();
  return decodeOutcome(callNative(() => addon.codecFeed(handle, bytes)));
}

/// Where the last fold stopped, for a caller resuming an input it could not finish.
export function codecFeedResume(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecResume(handle));
}

/// Events waiting to be taken, including one already selected.
export function pendingCodecEvents(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecPending(handle));
}

/// Selects the oldest event, control frames ahead of data messages.
export function selectCodecEvent(handle: bigint): boolean {
  const addon = loadAddon();
  return callNative(() => addon.codecSelect(handle));
}

/// The selected event, copied into a Node-owned `Buffer` on the native side of the
/// boundary, or null when there is none. Valid until `takeCodecEvent`; the caller
/// reads the fragment boundaries in the same window.
export function selectedCodecEvent(handle: bigint): CodecEvent | null {
  const addon = loadAddon();
  const event: NativeCodecEvent | null = callNative(() => addon.codecEvent(handle));
  if (event === null) return null;
  return { kind: CODEC_KINDS[event[0]] ?? "rejected", code: event[1], payload: event[2] };
}

/// Retires the selected event and frees its slot.
export function takeCodecEvent(handle: bigint): void {
  const addon = loadAddon();
  callNative(() => addon.codecTake(handle));
}

/// The interior fragment boundaries of the selected data message, or null when it
/// arrived whole. Read between `selectedCodecEvent` and `takeCodecEvent`, because the
/// boundaries borrow the same reassembly buffer the payload does.
export function codecFragmentEnds(handle: bigint): number[] | null {
  const addon = loadAddon();
  return callNative(() => addon.codecFragments(handle));
}
