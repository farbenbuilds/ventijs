import {
  codecFailure,
  codecFailureCode,
  type CodecEvent,
  type CodecKindName,
} from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import type { WebSocket } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { closeFromPeer } from "./codec-peer-close";
import { failureByCode, refuseByCodec } from "./codec-refusal";
import { writePong } from "./codec-outbound";
import { shapeBinary } from "./payload-shape";

/// The handle is a parameter, not a second lookup: the `rejected` branch needs the code
/// the codec latched, and a re-lookup could read a different codec.
export function dispatch(
  state: SocketState,
  handle: bigint,
  kind: CodecKindName,
  code: number,
  payload: Buffer,
  ends: readonly number[] | null,
): void {
  switch (kind) {
    case "text":
      // A Buffer, not a string: `ws` converts only for the DOM wrapper.
      emitEvent(state, "message", payload, false);
      return;
    case "binary":
      emitBinary(state, payload, ends);
      return;
    case "ping":
      // RFC 6455 section 5.5.2 wants the pong promptly, so it goes out before the
      // application hears the ping: a blocking listener would push it past its deadline.
      if (state.autoPong) writePong(state, payload);
      emitEvent(state, "ping", payload);
      return;
    case "pong":
      emitEvent(state, "pong", payload);
      return;
    case "close":
      closeFromPeer(state, { kind, code, payload });
      return;
    case "rejected":
      // Latched on the codec, not carried in the event: a refused frame ends the
      // connection, so the copy would be a string nobody read.
      refuseByCodec(state, codecFailure(handle) ?? failureByCode(codecFailureCode(handle)));
      return;
  }
}

/// The events a single read can produce more than one of. `open` and `close` are terminal.
export function isDeferrable(event: CodecEvent | null): boolean {
  if (event === null) return false;
  return (
    event.kind === "text" ||
    event.kind === "binary" ||
    event.kind === "ping" ||
    event.kind === "pong"
  );
}

/// A binary message, shaped by the socket's `binaryType`. The cast is `ws`'s own type
/// gap: `@types/ws` narrows `binaryType` to three Buffer views and drops `Blob` from
/// `RawData`, while its runtime accepts `"blob"`. Honouring the caller's value
/// reproduces that with the vendored declarations left byte-identical.
function emitBinary(state: SocketState, payload: Buffer, ends: readonly number[] | null): void {
  const shaped = shapeBinary(state.binaryType, payload, ends);
  emitEvent(state, "message", shaped as WebSocket.RawData, true);
}
