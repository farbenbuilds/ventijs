import {
  codecFailure,
  codecFailureCode,
  codecFragmentEnds,
  pendingCodecEvents,
  selectCodecEvent,
  selectedCodecEvent,
  takeCodecEvent,
  type CodecEvent,
} from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import type { WebSocket } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { CLOSED } from "../ready-state";
import { codecOf } from "./codec-handle";
import { shapeBinary } from "./payload-shape";
import { closeFromPeer } from "./codec-peer-close";
import { failureByCode, refuseByCodec } from "./codec-refusal";
import { writePong } from "./codec-outbound";
import { isDeliveryPaused, pauseUntilNextTick } from "./codec-deferral";

/// Delivers every queued event, control frames first. The select/take window is kept on
/// this side of the pump, which is what lets a caller read fragment boundaries: they
/// borrow the buffer the next frame overwrites.
export function deliver(state: SocketState, resume: () => void): void {
  drain(state, false, resume);
}

/// Delivers the event a pause was waiting for, then goes back to the policy. The policy is
/// not re-applied to that event: it has had its decision, so re-applying defers it for
/// ever. One event per tick is what `ws` delivers.
export function drainReleased(state: SocketState): void {
  drain(state, true, () => undefined);
}

function drain(state: SocketState, released: boolean, resume: () => void): void {
  const handle = codecOf(state);
  if (handle === null) return;
  if (isDeliveryPaused(state)) return;
  let honoured = released;
  while (pendingCodecEvents(handle) > 0 && selectCodecEvent(handle)) {
    const event = selectedCodecEvent(handle);
    // `allowSynchronousEvents: false` moves the application's turn to observe a message
    // to a later tick, and stops the drain so the frames behind it are not read until the
    // application has heard about this one. The automatic pong is not deferred with it:
    // RFC 6455 section 5.5.2 gives that a deadline and the option does not. Decided
    // *before* the event is taken, because taking retires the slot and deferring after
    // would discard the very message the pause is waiting for.
    if (!honoured && state.allowSynchronousEvents === false && isDeferrable(event)) {
      pauseUntilNextTick(state, resume);
      return;
    }
    honoured = false;
    // Read inside the select/take window: the only one where the reassembly buffer is
    // still this message, so fragments are readable here or not at all.
    const ends = codecFragmentEnds(handle);
    takeCodecEvent(handle);
    if (event === null) continue;
    dispatch(state, handle, event, ends);
    if (state.readyState === CLOSED) return;
  }
}

/// The events a single read can produce more than one of. `open` and `close` are terminal.
function isDeferrable(event: CodecEvent | null): boolean {
  if (event === null) return false;
  return (
    event.kind === "text" ||
    event.kind === "binary" ||
    event.kind === "ping" ||
    event.kind === "pong"
  );
}

/// The handle is a parameter, not a second lookup: the `rejected` branch needs the code
/// the codec latched, and a re-lookup could read a different codec.
export function dispatch(
  state: SocketState,
  handle: bigint,
  event: CodecEvent,
  ends: readonly number[] | null,
): void {
  switch (event.kind) {
    case "text":
      // A Buffer, not a string: `ws` converts only for the DOM wrapper.
      emitEvent(state, "message", event.payload, false);
      return;
    case "binary":
      emitBinary(state, event, ends);
      return;
    case "ping":
      // RFC 6455 section 5.5.2 wants the pong promptly, so it goes out before the
      // application hears the ping: a blocking listener would push it past its deadline.
      if (state.autoPong) writePong(state, event.payload);
      emitEvent(state, "ping", event.payload);
      return;
    case "pong":
      emitEvent(state, "pong", event.payload);
      return;
    case "close":
      closeFromPeer(state, event);
      return;
    case "rejected":
      // Latched on the codec, not carried in the event: a refused frame ends the
      // connection, so the copy would be a string nobody read.
      refuseByCodec(state, codecFailure(handle) ?? failureByCode(codecFailureCode(handle)));
      return;
  }
}

/// A binary message, shaped by the socket's `binaryType`. The cast is `ws`'s own type
/// gap: `@types/ws` narrows `binaryType` to three Buffer views and drops `Blob` from
/// `RawData`, while its runtime accepts `"blob"`. Honouring the caller's value
/// reproduces that with the vendored declarations left byte-identical.
function emitBinary(state: SocketState, event: CodecEvent, ends: readonly number[] | null): void {
  const payload = shapeBinary(state.binaryType, event.payload, ends);
  emitEvent(state, "message", payload as WebSocket.RawData, true);
}
