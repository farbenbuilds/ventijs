import type { CodecKindName } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { defer, notOpenError, type SocketPayload } from "./payload";
import { frameError, writeFrame } from "./codec-outbound";
import { createError } from "../errors";
import { reportFailure } from "./send-failure";

/// The `ws` send options this route reads, resolved once per call. Both are wrong on the
/// wire rather than absent when ignored: `binary: false` frames a binary message where
/// `ws` frames text, and `fin: false` frames a complete message with the `fin` bit set.
/// Neither produced an error, and both are found only against a correct peer.
export type FrameOptions = {
  readonly binary: boolean;
  readonly fin: boolean;
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
  const framing = frameOptions(options, payload.binary);
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
    mayCompress(state, framing.fin, payload.bytes.length),
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
/// error. The message must be complete, because a one-shot compressor cannot produce the
/// sync flush a continuation frame needs; `ws` does compress those, so this is a
/// documented subset and a fragmented message goes out uncompressed, which every peer
/// reads. And the payload must reach the threshold, `ws`'s `permessage-deflate.js:56-57`
/// default of 1024 bytes, below which deflate makes a message longer more often than not.
function mayCompress(state: SocketState, fin: boolean, length: number): boolean {
  if (!state.compressible || state.fragmentsOpen || !fin) return false;
  return length >= state.threshold;
}

/// An out-of-type value is ignored rather than coerced, as `ws` does with `opts.binary`.
function frameOptions(options: unknown, autodetected: boolean): FrameOptions {
  if (typeof options !== "object" || options === null) {
    return { binary: autodetected, fin: true };
  }
  const source = options as { binary?: unknown; fin?: unknown };
  return {
    binary: typeof source.binary === "boolean" ? source.binary : autodetected,
    fin: typeof source.fin === "boolean" ? source.fin : true,
  };
}

function unhandledFrameStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventijs: the codec reported an unknown frame status "${String(status)}"`,
  );
}
