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

/// Folds the transport's bytes into the socket's codec and delivers what comes out.
/// `pending` is what arrived with the upgrade response. Per
/// `docs/adr/0001-transport-and-framing-ownership.md` this moves bytes, never reads a
/// frame.
export function driveInbound(state: SocketState, transport: Duplex, pending?: Buffer): void {
  // Fed first: a read can deliver the response and the first frame together, and the
  // listener would otherwise take the newer bytes first.
  if (pending !== undefined && pending.length > 0) ingest(state, pending);
  transport.on("data", (chunk: Buffer) => {
    ingest(state, chunk);
  });
}

/// Feeds one read and delivers what it decoded. A full queue stops the decoder rather
/// than overwriting a queued payload, and the tail is re-fed once the caller has drained:
/// pausing the transport here would deadlock a peer that only sends in response.
export function ingest(state: SocketState, chunk: Buffer): void {
  const handle = codecOf(state);
  if (handle === null) return;
  if (state.pendingInput !== null) {
    // A deferred delivery holds earlier bytes, so this chunk would decode out of order.
    return;
  }
  let rest = chunk;
  while (rest.length > 0) {
    const outcome = feedCodec(handle, rest);
    // A throwing listener must not also cost the connection. `rest` is a local, so an
    // exception out of the dispatch loses it and leaves the codec holding half a frame,
    // which garbles the next message or refuses the connection for a fault the peer never
    // committed. Finishing the socket first turns one throwing handler into one dead
    // connection.
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
      state.pendingInput = rest;
      return;
    }
  }
}

/// Ends a connection whose dispatch threw, then lets the throw continue: what stops here
/// is the corruption, not the application's own exception.
function failOnThrow(state: SocketState, error: unknown): void {
  if (state.readyState === CLOSED) return;
  failConnection(
    state,
    error instanceof Error ? error : createError("ERR_PROTOCOL", String(error)),
  );
  closeCodec(state);
  state.transport?.destroy();
}

/// What a deferred delivery resumes with, through the same guard as the read that
/// started it: a throw from a handler on a `allowSynchronousEvents: false` socket
/// arrives from a `setImmediate` and would otherwise lose the same tail.
function guardedResume(state: SocketState): void {
  try {
    resume(state);
  } catch (error) {
    failOnThrow(state, error);
    throw error;
  }
}

/// What a deferred delivery resumes with. The pause is a *parse* pause, as in `ws`, so
/// the tail needs a home the resume can find: `state.pendingInput`, at most one read.
function resume(state: SocketState): void {
  drainReleased(state);
  const pending = state.pendingInput;
  state.pendingInput = null;
  if (pending !== null && pending.length > 0) ingest(state, pending);
}
