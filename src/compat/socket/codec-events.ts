import {
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
import { refuseByCodec } from "./codec-refusal";
import { writePong } from "./codec-outbound";
import { isDeliveryPaused, pauseUntilNextTick } from "./codec-deferral";

/// Delivers every queued event, control frames first.
///
/// The pump and this are separate because the two answer different questions: one is
/// "how many bytes did the peer send", the other is "what does the application see".
/// Keeping the codec's select/take window on this side is what lets a caller read the
/// fragment boundaries, which borrow the very buffer the next frame overwrites.
///
/// `resume` is the pump's own function rather than something this module builds,
/// because resuming is not only about dispatching: the bytes the pause held are the
/// pump's, and only the pump knows how to re-feed them.
export function deliver(state: SocketState, resume: () => void): void {
  drain(state, false, resume);
}

/// Delivers the event a pause was waiting for, and then goes back to the policy.
///
/// The policy is not re-applied to the event the socket was paused *for*: it has
/// already had its decision, so applying it again defers the same event for ever and
/// the application never sees it. One event per tick is also what `ws` delivers,
/// because its parse loop resumes and then stops at the next message.
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
    // `allowSynchronousEvents: false` moves the application's turn to observe a
    // message to a later tick, and stops the drain here so the frames behind it are
    // not read until the application has heard about this one. The automatic pong is
    // not deferred with it, because RFC 6455 section 5.5.2 gives that a deadline and
    // the option does not.
    //
    // Decided *before* the event is taken, and that order matters too: taking it
    // retires the slot, so deferring afterwards would discard the very message the
    // pause is waiting for. The event stays selected, the resume selects it again, and
    // the codec holds it in the meantime.
    if (!honoured && state.allowSynchronousEvents === false && isDeferrable(event)) {
      pauseUntilNextTick(state, resume);
      return;
    }
    honoured = false;
    // Read inside the select/take window, which is the only window in which the
    // codec's reassembly buffer is still this message. A caller that wanted the
    // fragments has to ask here or not at all.
    const ends = codecFragmentEnds(handle);
    takeCodecEvent(handle);
    if (event === null) continue;
    dispatch(state, handle, event, ends);
    if (state.readyState === CLOSED) return;
  }
}

/// The events `ws` defers, which are the ones a single read can produce more than one
/// of. `open` and `close` are terminal and arrive once, and deferring them would only
/// make a caller wait a tick for a fact that is already true.
function isDeferrable(event: CodecEvent | null): boolean {
  if (event === null) return false;
  return (
    event.kind === "text" ||
    event.kind === "binary" ||
    event.kind === "ping" ||
    event.kind === "pong"
  );
}

/// One decoded event, as the facade's event.
///
/// The handle is a parameter rather than looked up again because the `rejected` branch
/// needs the code the codec latched, and reading it from a second lookup would be a
/// chance to read a different codec than the one that queued the event.
export function dispatch(
  state: SocketState,
  handle: bigint,
  event: CodecEvent,
  ends: readonly number[] | null,
): void {
  switch (event.kind) {
    case "text":
      // A Buffer, not a string: `ws` hands its Node listeners the reassembled buffer
      // and converts only for the DOM wrapper, and a caller reading `message` must
      // see the same bytes the peer sent.
      emitEvent(state, "message", event.payload, false);
      return;
    case "binary":
      emitBinary(state, event, ends);
      return;
    case "ping":
      // Section 5.5.2 requires the pong promptly, so it goes out before the
      // application hears about the ping: a listener that blocks would otherwise
      // delay the answer past its deadline. `autoPong: false` is the one caller choice
      // that suppresses it, and the application answers with `pong()` itself.
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
      // The code is latched on the codec because one refused frame ends the
      // connection; the queued description names the reason for the error.
      refuseByCodec(state, codecFailureCode(handle));
      return;
  }
}

/// A binary message, shaped by the socket's `binaryType`.
///
/// The cast is `ws`'s own type gap: `@types/ws` narrows `binaryType` to the three
/// Buffer views and drops `Blob` from `RawData`, while its runtime accepts `"blob"`
/// and delivers one. Honouring the value the caller set and widening past the
/// declaration reproduces that exactly, and the vendored declarations stay
/// byte-identical to the pinned `@types/ws`.
function emitBinary(state: SocketState, event: CodecEvent, ends: readonly number[] | null): void {
  const payload = shapeBinary(state.binaryType, event.payload, ends);
  emitEvent(state, "message", payload as WebSocket.RawData, true);
}
