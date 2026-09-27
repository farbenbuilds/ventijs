import type { Duplex } from "node:stream";
import {
  codecFeedResume,
  codecFailureCode,
  feedCodec,
  pendingCodecEvents,
  selectCodecEvent,
  selectedCodecEvent,
  takeCodecEvent,
  type CodecEvent,
} from "../../binding/codec";
import { CLOSE_ABNORMAL, CLOSE_NORMAL } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { CLOSED, CLOSING } from "../ready-state";
import { closeCodec, codecOf } from "./codec-handle";
import { refuseByCodec } from "./codec-refusal";
import { writeCloseFrame, writePong } from "./codec-outbound";
import { finishConnection } from "./lifecycle";

/// Folds the transport's bytes into the socket's codec and delivers what comes out.
/// `pending` is what arrived with the upgrade response, if anything did.
///
/// The codec is the only thing that knows what a frame is, per
/// `docs/adr/0001-transport-and-framing-ownership.md`: this module moves bytes and
/// dispatches events, and never looks at an opcode or a length itself.
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
  let rest = chunk;
  // Bounded by the input: every pass either consumes bytes or stops, and a refusal
  // or an empty queue both end the loop.
  while (rest.length > 0) {
    const outcome = feedCodec(handle, rest);
    deliver(state);
    if (outcome.kind === "failed") {
      // The code the codec latched is the one the RFC assigns this refusal, and it
      // is what both ends of the connection get to see.
      refuseByCodec(state, codecFailureCode(handle));
      return;
    }
    if (outcome.kind === "stale-handle") return;
    const consumed = outcome.kind === "consumed" ? outcome.bytes : codecFeedResume(handle);
    if (consumed <= 0) return;
    rest = rest.subarray(consumed);
    if (outcome.kind === "consumed") return;
  }
}

/// Delivers every queued event, control frames first.
export function deliver(state: SocketState): void {
  const handle = codecOf(state);
  if (handle === null) return;
  while (pendingCodecEvents(handle) > 0 && selectCodecEvent(handle)) {
    const event = selectedCodecEvent(handle);
    takeCodecEvent(handle);
    if (event === null) continue;
    dispatch(state, handle, event);
    if (state.readyState === CLOSED) return;
  }
}

/// One decoded event, as the facade's event.
///
/// The handle is a parameter rather than looked up again because the `rejected` branch
/// needs the code the codec latched, and reading it from a second lookup would be a
/// chance to read a different codec than the one that queued the event.
function dispatch(state: SocketState, handle: bigint, event: CodecEvent): void {
  switch (event.kind) {
    case "text":
      // A Buffer, not a string: `ws` hands its Node listeners the reassembled buffer
      // and converts only for the DOM wrapper, and a caller reading `message` must
      // see the same bytes the peer sent.
      emitEvent(state, "message", event.payload, false);
      return;
    case "binary":
      emitEvent(state, "message", event.payload, true);
      return;
    case "ping":
      // Section 5.5.2 requires the pong promptly, so it goes out before the
      // application hears about the ping: a listener that blocks would otherwise
      // delay the answer past its deadline.
      writePong(state, event.payload);
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

/// The peer's close frame: answer it, then finish.
///
/// `ws` echoes a close frame it did not send one for, and the socket's own close
/// code is the peer's, so a clean close reports the code the peer chose rather than
/// 1006 for a handshake that did happen.
function closeFromPeer(state: SocketState, event: CodecEvent): void {
  if (state.readyState !== CLOSING) state.readyState = CLOSING;
  state.closeFrameReceived = true;
  if (!state.closeFrameSent) {
    // The echo carries the peer's own code, which is what a clean shutdown needs:
    // an empty close frame would report 1005 and read as a protocol fault.
    writeCloseFrame(state, event.code === 0 ? CLOSE_NORMAL : event.code, event.payload);
  }
  const code = event.code === 0 ? CLOSE_ABNORMAL : event.code;
  finishConnection(state, code, event.payload);
  // The handshake is over, so the transport is ended rather than left for a peer
  // that has already said everything it is going to. `ws` does the same, and it is
  // what stops a socket sitting on an idle connection after a clean close.
  closeCodec(state);
  state.transport?.end();
}
