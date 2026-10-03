import {
  CODEC_OUTCOME,
  codecFailure,
  codecFailureCode,
  codecFeedResume,
  feedCodecCount,
  materializeCodec,
  processCodecInto,
  type CodecFirst,
} from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { isDeliveryPaused } from "./codec-deferral";
import { deliver } from "./codec-events";
import { failureByCode, refuseByCodec } from "./codec-refusal";
import { failConnection } from "./lifecycle";

/// `ws` refuses at the same bound with the same code from `Receiver.prototype._write`: an
/// unbounded queue behind a wedged parse is the exhaustion this option exists to prevent.
export function enqueue(state: SocketState, chunk: Buffer): void {
  if (state.maxBufferedChunks > 0 && state.pendingInput.length >= state.maxBufferedChunks) {
    refuseByCodec(state, "tooManyBufferedParts");
  } else {
    state.pendingInput.push(chunk);
  }
}

/// Ends a connection whose dispatch threw, then lets the throw continue: what stops here
/// is the corruption, not the application's own exception.
export function failOnThrow(state: SocketState, error: unknown): void {
  if (state.readyState === CLOSED) return;
  // The teardown is in a `finally` because `failConnection` emits `error` and an application
  // listener may throw, which would leak the codec slot on this path.
  try {
    failConnection(
      state,
      error instanceof Error ? error : createError("ERR_PROTOCOL", String(error)),
    );
  } finally {
    closeCodec(state);
    state.transport?.destroy();
  }
}

/// Feeds one read and delivers what it decoded. A full event store stops the decoder rather
/// than overwriting a queued payload, and the tail is re-fed once drained: pausing the
/// transport here would deadlock a peer that only sends in response. `resume` is the
/// caller's drain, run if the delivery pauses.
export function consume(
  state: SocketState,
  handle: bigint,
  chunk: Buffer,
  resume: () => void,
): void {
  const wantEnds = state.binaryType === "fragments";
  for (;;) {
    let count: number;
    let first: CodecFirst | null = null;
    // The deferred path pauses before the take, so it cannot use the fused call: that call
    // retires the first event before the pause decision is made.
    if (state.allowSynchronousEvents === false) {
      count = feedCodecCount(handle, chunk);
    } else {
      // The read's bytes bound the first event's payload; a message assembled across reads
      // can exceed it, and the codec then reports the size for one materialize call.
      let out = Buffer.allocUnsafe(chunk.length);
      let processed = processCodecInto(handle, chunk, wantEnds, out);
      if (typeof processed === "number" && processed > 0) {
        out = Buffer.allocUnsafe(processed);
        processed = materializeCodec(handle, wantEnds, out);
      }
      // A successful fold consumes the whole input, so the resume offset is the chunk
      // length; only a refusal carries its own.
      if (processed === null) {
        count = chunk.length;
      } else if (typeof processed === "number") {
        count = processed;
      } else {
        count = chunk.length;
        first = {
          kindCode: processed[0],
          payload: out.subarray(0, processed[1]),
          ends: processed[2] ?? null,
        };
      }
    }
    // A throwing listener must not also cost the connection: an exception out of the dispatch
    // loses the local `chunk` and leaves the codec holding half a frame, which garbles the next
    // message or refuses the connection for a fault the peer never committed.
    try {
      deliver(state, resume, first);
    } catch (error) {
      failOnThrow(state, error);
      throw error;
    }
    if (count === -CODEC_OUTCOME.failed) {
      // The codec latched why: the peer gets the close code, the application the `ws` error.
      refuseByCodec(state, codecFailure(handle) ?? failureByCode(codecFailureCode(handle)));
      return;
    }
    if (count === -CODEC_OUTCOME.staleHandle) return;
    // Non-negative is the whole input folded, which is every read that ends on a frame
    // boundary; the codec only stops short when the event store filled.
    if (count >= 0) return;
    const consumed = codecFeedResume(handle);
    if (consumed <= 0) return;
    const rest = chunk.subarray(consumed);
    // The store was full and `deliver` has emptied it, unless the delivery paused.
    if (isDeliveryPaused(state)) {
      enqueue(state, rest);
      return;
    }
    if (rest.length === 0) return;
    chunk = rest;
  }
}
