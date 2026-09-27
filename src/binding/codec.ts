import { CODEC_KINDS, decodeOutcome, type CodecKindName, type FeedOutcome } from "./codec-status";
import type { NativeCodecEvent } from "./native";
import { callNative } from "./errors";
import { loadAddon } from "./load";

export { codecOutbound, codecOutboundMasked, encodeCodecFrame } from "./codec-encode";
export { codecLimits } from "./codec-limits";
export { codecFailureCode, codecRole, resetCodec } from "./codec-state";
export {
  CODEC_ENCODE_FAILURES,
  CODEC_KINDS,
  CODEC_OUTCOME,
  CODEC_ROLE,
  type CodecEncodeFailure,
  type CodecKindName,
  type CodecRole,
  type FeedOutcome,
} from "./codec-status";

/// One decoded frame, copied out of the codec.
export type CodecEvent = {
  readonly kind: CodecKindName;
  /// Close code for a `close` event, 0 otherwise.
  readonly code: number;
  /// For a `close` event this is the reason alone: the two code bytes are not
  /// repeated here, because a caller that got them twice would have to know to
  /// strip them.
  readonly payload: Buffer;
};

/// Creates a frame codec and returns a generation-checked handle.
///
/// There is no capacity argument, because there is no second capacity: every codec
/// has the compiled one, and `codecLimits` reports it. An argument that was accepted
/// and only partly honoured would leave a caller believing it had negotiated a
/// `maxPayload` the codec does not enforce.
///
/// `validateUtf8` is the one policy a caller chooses, and it is the whole of
/// `skipUTF8Validation`: the codec is the validator, so an option the facade
/// normalized and did not read left a caller who trusts their own server with a hard
/// 1007 on a payload `ws` would have delivered mangled. The default is validation on.
export function createCodec(role: number, validateUtf8 = true): bigint {
  const addon = loadAddon();
  return callNative(() => addon.codecCreate(role, validateUtf8 ? 1 : 0));
}

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

/// Where the last `feed` stopped, which is where a backpressured input resumes.
///
/// A separate call because the sign of `feedCodec`'s return is already the outcome,
/// so a refusal leaves no room in it for the offset. Reading it wrong drops the rest
/// of a peer's frame or delivers one twice, which is why it is a named accessor
/// rather than something a caller reconstructs.
export function codecFeedResume(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecResume(handle));
}

/// Events waiting to be taken, so a caller can loop without calling `select` to
/// find out.
export function pendingCodecEvents(handle: bigint): number {
  const addon = loadAddon();
  return callNative(() => addon.codecPending(handle));
}

/// Selects the next event, or reports that there is none. Control frames come
/// ahead of data messages, because a ping the caller has not answered has a
/// deadline the rest of the queue does not.
export function selectCodecEvent(handle: bigint): boolean {
  const addon = loadAddon();
  return callNative(() => addon.codecSelect(handle));
}

/// The selected event, with its payload copied into a Node-owned buffer.
///
/// The copy is what makes the payload safe to retain: it borrows a buffer inside
/// the codec that the next frame overwrites, so a `Buffer` handed to a listener
/// would otherwise become the next message's bytes.
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

/// The fragment boundaries of the selected data message, ascending, or null when it
/// arrived whole or is not a data message.
///
/// Read between `selectedCodecEvent` and `takeCodecEvent`, which is the only window
/// in which the codec's reassembly buffer is still this message. It exists for
/// `binaryType: "fragments"`, which delivers the pieces a peer sent rather than the
/// whole message: one boundary list is cheaper than a second copy of the payload, and
/// it is the same list the compiled `maxFragments` bound is applied to.
export function codecFragmentEnds(handle: bigint): number[] | null {
  const addon = loadAddon();
  return callNative(() => addon.codecFragments(handle));
}
