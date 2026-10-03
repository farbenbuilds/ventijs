import type { Duplex } from "node:stream";
import type { SocketState } from "../../types/socket";
import { codecOf } from "./codec-handle";
import { isDeliveryPaused } from "./codec-deferral";
import { drainReleased } from "./codec-events";
import { consume, enqueue, failOnThrow } from "./codec-consumer";

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

/// Feeds one read and delivers what it decoded. A deferred delivery holds earlier bytes, so
/// this read would decode out of order; `ws` queues it too, and dropping it is how a peer
/// outrunning the application loses messages.
export function ingest(state: SocketState, chunk: Buffer): void {
  const handle = codecOf(state);
  if (handle === null) return;
  if (state.pendingInput.length > 0) {
    enqueue(state, chunk);
    return;
  }
  consume(state, handle, chunk, () => {
    guardedResume(state);
  });
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
/// queued reads need a home the resume can find: `state.pendingInput`, oldest first.
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
    consume(state, handle, chunk, () => {
      guardedResume(state);
    });
    if (!isDeliveryPaused(state)) continue;
    // `consume` queued its own read's unread tail, so the reads behind go after that tail:
    // this order is what keeps the bytes in the order the peer sent them.
    state.pendingInput = state.pendingInput.concat(queued.slice(index + 1));
    return;
  }
}
