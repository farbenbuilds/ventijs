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
/// `pending` is what arrived with the upgrade response, if anything did.
///
/// The codec is the only thing that knows what a frame is, per
/// `docs/adr/0001-transport-and-framing-ownership.md`: this module moves bytes and
/// never looks at an opcode or a length itself.
export function driveInbound(state: SocketState, transport: Duplex, pending?: Buffer): void {
  // The bytes that came with the upgrade response are fed before the listener goes on,
  // because a read can deliver the response and the first frame together and the
  // listener would otherwise take the newer bytes first. Ordering is observable: a
  // peer that greets with a frame expects that frame first.
  if (pending !== undefined && pending.length > 0) ingest(state, pending);
  transport.on("data", (chunk: Buffer) => {
    ingest(state, chunk);
  });
}

/// Feeds one read and delivers everything it decoded.
///
/// A full queue stops the decoder rather than overwriting a queued payload, so the
/// unconsumed tail is kept and re-fed once the caller has drained: pausing the
/// transport here instead would deadlock a peer that only sends in response to
/// something this socket has not written yet.
export function ingest(state: SocketState, chunk: Buffer): void {
  const handle = codecOf(state);
  if (handle === null) return;
  if (state.pendingInput !== null) {
    // A deferred delivery is still holding the bytes it has not decoded yet, and they
    // came first. This chunk would decode out of order, so it is dropped rather than
    // delivered as though the peer had sent it earlier.
    return;
  }
  let rest = chunk;
  // Bounded by the input: every pass either consumes bytes or stops, and a refusal, a
  // full queue, or a deferred delivery all end the loop.
  while (rest.length > 0) {
    const outcome = feedCodec(handle, rest);
    // A listener that throws is the application's own bug, and it must not also cost
    // the connection. `rest` is the undecoded tail of this read and it is a local, so
    // an exception out of the dispatch loses it: the codec is left holding half a frame
    // and the next read starts a fresh one, which delivers a garbled message or refuses
    // the connection for a framing fault the peer never committed. Finishing the socket
    // first turns one throwing handler into one dead connection instead.
    try {
      deliver(state, () => {
        resume(state);
      });
    } catch (error) {
      failOnThrow(state, error);
      throw error;
    }
    if (outcome.kind === "failed") {
      // The codec latched why, and both ends of the connection get a reason: the peer
      // the close code, the application the `ws` error code.
      refuseByCodec(state, codecFailure(handle) ?? failureByCode(codecFailureCode(handle)));
      return;
    }
    if (outcome.kind === "stale-handle") return;
    const consumed = outcome.kind === "consumed" ? outcome.bytes : codecFeedResume(handle);
    if (consumed <= 0) return;
    rest = rest.subarray(consumed);
    if (outcome.kind === "consumed") return;
    // The decode stopped because the event store was full, and `deliver` has just
    // emptied it -- unless the delivery paused, in which case the codec still holds an
    // event and the tail is not ours to re-feed yet.
    if (isDeliveryPaused(state)) {
      state.pendingInput = rest;
      return;
    }
  }
}

/// Ends a connection whose dispatch threw, then lets the throw continue.
///
/// The application's own exception keeps propagating, so a throw from a `message` listener
/// is still a throw from a `message` listener rather than a silent close; what stops
/// here is the corruption.
function failOnThrow(state: SocketState, error: unknown): void {
  if (state.readyState === CLOSED) return;
  failConnection(
    state,
    error instanceof Error ? error : createError("ERR_PROTOCOL", String(error)),
  );
  closeCodec(state);
  state.transport?.destroy();
}

/// What a deferred delivery resumes with.
///
/// The pause is a *parse* pause, which is what `ws` does and what the option is for:
/// the bytes behind the message the application has not heard about yet are not
/// decoded until it has. That means the chunk the transport handed over has a tail
/// this module still owns, and the tail has to be somewhere the resume can find it.
/// `state.pendingInput` is that somewhere, and it holds at most one read -- Node's
/// own high-water mark -- so the cost is bounded and only for a socket that asked for
/// deferred events.
function resume(state: SocketState): void {
  drainReleased(state);
  const pending = state.pendingInput;
  state.pendingInput = null;
  if (pending !== null && pending.length > 0) ingest(state, pending);
}
