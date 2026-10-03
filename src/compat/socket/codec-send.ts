import type { CodecKindName } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { defer, notOpenError, type SocketPayload } from "./payload";
import { frameError, writeFrame } from "./codec-outbound";
import { createError } from "../errors";
import { reportFailure } from "./send-failure";

/// The `ws` send options this route reads, resolved once per call against the defaults at
/// `websocket.js:472-478`. All four were wrong on the wire rather than absent when ignored.
type OptionsSource = {
  binary?: unknown;
  fin?: unknown;
  compress?: unknown;
  mask?: unknown;
};

const NO_OPTIONS: OptionsSource = {};

/// A separate module from the staging path because its statuses are the codec's, not the
/// engine's, and the two vocabularies are not interchangeable: a codec `backpressure` is
/// a full event queue on one connection, the engine's a full ring across a server.
export function sendFramed(
  state: SocketState,
  payload: SocketPayload,
  options: unknown,
  callback: unknown,
): void {
  const source =
    typeof options === "object" && options !== null ? (options as OptionsSource) : NO_OPTIONS;
  const binary = booleanOr(source.binary, payload.binary);
  const fin = booleanOr(source.fin, true);
  const compress = booleanOr(source.compress, true);
  // A server never masks whatever the caller asked for, and `codec-outbound.ts` refuses it
  // again; the default is the only place that decision is duplicated.
  const mask = booleanOr(source.mask, !state.isServer);
  // RFC 6455 section 5.4: the first frame of a fragmented message carries the data
  // opcode and every later frame carries opcode 0. Choosing the opcode from whether the
  // socket is mid-message is what makes `fin` a real fragmentation, not two messages.
  const kind: CodecKindName = state.fragmentsOpen ? "continuation" : binary ? "binary" : "text";
  const status = writeFrame(
    state,
    kind,
    payload.bytes,
    fin,
    mayCompress(state, compress, fin, payload.bytes.length),
    mask,
  );
  // Latched on success only, so a refused send leaves the message open to retry.
  if (status === "ok") state.fragmentsOpen = !fin;
  switch (status) {
    case "ok":
      defer(callback);
      return;
    case "backpressure":
    case "closing":
    case "closed":
      // Not a failure: `ws` reports these through the callback and leaves the socket
      // alone, because a send that arrived too late is not the socket's fault.
      defer(callback, notOpenError(state.readyState));
      return;
    case "invalid-handle":
    case "payload-too-large":
    case "protocol-error":
      reportFailure(state, callback, frameError(status));
      return;
  }
  // `never` is the compile-time proof that a new union member is handled, not ignored.
  throw unhandledFrameStatus(status);
}

/// Three rules, not preferences. The extension must be negotiated or RSV1 is a protocol
/// error, the message must be complete, and the payload must reach the threshold; the
/// caller's `compress: false` short-circuits all three.
function mayCompress(state: SocketState, compress: boolean, fin: boolean, length: number): boolean {
  if (!compress || !state.compressible || !fin || state.fragmentsOpen) return false;
  return length >= state.threshold;
}

/// An out-of-type value is ignored rather than coerced, as `ws` does with `opts.binary`.
function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function unhandledFrameStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventiws: the codec reported an unknown frame status "${String(status)}"`,
  );
}
