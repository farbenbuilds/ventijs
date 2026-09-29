import type { Duplex } from "node:stream";
import { codecFailure, codecFailureCode, codecFeedResume, feedCodec } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { closeCodec, codecOf } from "./codec-handle";
import { isDeliveryPaused } from "./codec-deferral";
import { failureByCode, refuseByCodec } from "./codec-refusal";
import { deliver, drainReleased } from "./codec-events";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { failConnection } from "./lifecycle";

/// Folds the transport's bytes into the socket's codec and delivers what comes out. `pending`
/// is what arrived with the upgrade response; per the ADR this moves bytes, never reads a frame.
export function driveInbound(state: SocketState, transport: Duplex, pending?: Buffer): void {
  // Fed first: a read can deliver the response and the first frame together, and the
  // listener would otherwise take the newer bytes first.
  if (pending !== undefined && pending.length > 0) ingest(state, pending);
  transport.on("data", (chunk: Buffer) => {
    ingest(state, chunk);
  });
}

/// Feeds one read and delivers what it decoded. A full event store stops the decoder rather
/// than overwriting a queued payload, and the tail is re-fed once drained: pausing the
/// transport here would deadlock a peer that only sends in response.
export function ingest(state: SocketState, chunk: Buffer): void {
  const handle = codecOf(state);
  if (handle === null) return;
  // A deferred delivery holds earlier bytes, so this read would decode out of order. `ws`
  // queues it too; dropping it is how a peer outrunning the application loses messages.
  if (state.pendingInput.length > 0) {
    enqueue(state, chunk);
    return;
  }
  consume(state, handle, chunk);
}

/// `ws` refuses at the same bound with the same code from `Receiver.prototype._write`: an
/// unbounded queue behind a wedged parse is the exhaustion this option exists to prevent.
function enqueue(state: SocketState, chunk: Buffer): void {
  if (state.maxBufferedChunks > 0 && state.pendingInput.length >= state.maxBufferedChunks) {
    refuseByCodec(state, "tooManyBufferedParts");
  } else {
    state.pendingInput.push(chunk);
  }
}

function consume(state: SocketState, handle: bigint, chunk: Buffer): void {
  let rest = chunk;
  while (rest.length > 0) {
    const outcome = feedCodec(handle, rest);
    // A throwing listener must not also cost the connection: an exception out of the dispatch
    // loses the local `rest` and leaves the codec holding half a frame, which garbles the next
    // message or refuses the connection for a fault the peer never committed.
    try {
      deliver(state, () => {
        guardedResume(state);
      });
    } catch (error) {
      failOnThrow(state, error);
      throw error;
    }
    if (outcome.kind === "failed") {
      // The codec latched why: the peer gets the close code, the application the `ws` error.
      refuseByCodec(state, codecFailure(handle) ?? failureByCode(codecFailureCode(handle)));
      return;
    }
    if (outcome.kind === "stale-handle") return;
    const consumed = outcome.kind === "consumed" ? outcome.bytes : codecFeedResume(handle);
    if (consumed <= 0) return;
    rest = rest.subarray(consumed);
    if (outcome.kind === "consumed") return;
    // The store was full and `deliver` has emptied it, unless the delivery paused.
    if (isDeliveryPaused(state)) {
      enqueue(state, rest);
      return;
    }
  }
}

/// Ends a connection whose dispatch threw, then lets the throw continue: what stops here
/// is the corruption, not the application's own exception.
function failOnThrow(state: SocketState, error: unknown): void {
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

/// What a deferred delivery resumes with, through the same guard as the read that started
/// it: a throw from a handler on a deferred socket arrives from a `setImmediate`.
function guardedResume(state: SocketState): void {
  try {
    resume(state);
  } catch (error) {
    failOnThrow(state, error);
    throw error;
  }
}

/// What a deferred delivery resumes with. The pause is a *parse* pause, as in `ws`, so the
/// queued reads need a home the resume can find: `state.pendingInput`, oldest first. The
/// loop rather than one read, because a drain can defer again part-way through the queue.
function resume(state: SocketState): void {
  drainReleased(state, () => {
    guardedResume(state);
  });
  const queued = state.pendingInput;
  const handle = codecOf(state);
  // Cleared before the next read is fed, so a chunk arriving from that read's own delivery
  // is consumed in order rather than queued behind the tail it is draining.
  state.pendingInput = [];
  if (handle === null) return;
  for (const [index, chunk] of queued.entries()) {
    if (codecOf(state) === null) return;
    consume(state, handle, chunk);
    if (!isDeliveryPaused(state)) continue;
    // `consume` queued its own read's unread tail, so the reads behind go after that tail:
    // this order is what keeps the bytes in the order the peer sent them.
    state.pendingInput = state.pendingInput.concat(queued.slice(index + 1));
    return;
  }
}
