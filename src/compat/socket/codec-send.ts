import type { CodecKindName } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { defer, notOpenError, type SocketPayload } from "./payload";
import { frameError, writeFrame } from "./codec-outbound";
import { createError } from "../errors";
import { reportFailure } from "./send-failure";

/// The `ws` send options this route reads, resolved once per call against the defaults at
/// `websocket.js:472-478`. All four were wrong on the wire rather than absent when ignored,
/// and each is found only against a peer that reads the bytes.
export type FrameOptions = {
  readonly binary: boolean;
  readonly fin: boolean;
  readonly compress: boolean;
  readonly mask: boolean;
};

/// A separate module from the staging path because its statuses are the codec's, not the
/// engine's, and the two vocabularies are not interchangeable: a codec `backpressure` is
/// a full event queue on one connection, the engine's a full ring across a server.
export function sendFramed(
  state: SocketState,
  payload: SocketPayload,
  options: unknown,
  callback: unknown,
): void {
  const framing = frameOptions(options, payload.binary, state.isServer);
  // RFC 6455 section 5.4: the first frame of a fragmented message carries the data
  // opcode and every later frame carries opcode 0. Choosing the opcode from whether the
  // socket is mid-message is what makes `fin` a real fragmentation, not two messages.
  const kind: CodecKindName = state.fragmentsOpen
    ? "continuation"
    : framing.binary
      ? "binary"
      : "text";
  const status = writeFrame(
    state,
    kind,
    payload.bytes,
    framing.fin,
    mayCompress(state, framing, payload.bytes.length),
    framing.mask,
  );
  // Latched on success only, so a refused send leaves the message open to retry.
  if (status === "ok") state.fragmentsOpen = !framing.fin;
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
/// error, and the message must be complete, because a one-shot compressor cannot produce the
/// sync flush a continuation frame needs; a fragmented message therefore goes out
/// uncompressed, which every peer reads. The payload must also reach the threshold, `ws`'s
/// 1024-byte default. The caller's `compress: false` short-circuits all three, which is how
/// `ws` reads it: `rsv1` starts at `options.compress` and the threshold only lowers it.
function mayCompress(state: SocketState, framing: FrameOptions, length: number): boolean {
  if (!framing.compress || !state.compressible || !framing.fin || state.fragmentsOpen) {
    return false;
  }
  return length >= state.threshold;
}

/// An out-of-type value is ignored rather than coerced, as `ws` does with `opts.binary`.
function frameOptions(options: unknown, autodetected: boolean, isServer: boolean): FrameOptions {
  const source =
    typeof options === "object" && options !== null ? (options as FrameOptionsRaw) : {};
  return {
    binary: booleanOr(source.binary, autodetected),
    fin: booleanOr(source.fin, true),
    compress: booleanOr(source.compress, true),
    // A server never masks whatever the caller asked for, and `codec-outbound.ts` refuses it
    // again; the default is the only place that decision is duplicated.
    mask: booleanOr(source.mask, !isServer),
  };
}

type FrameOptionsRaw = {
  binary?: unknown;
  fin?: unknown;
  compress?: unknown;
  mask?: unknown;
};

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function unhandledFrameStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventiws: the codec reported an unknown frame status "${String(status)}"`,
  );
}
