import type { CodecKindName } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { defer, notOpenError, type SocketPayload } from "./payload";
import { frameError, writeFrame } from "./codec-outbound";
import { createError } from "../errors";
import { reportFailure } from "./send-failure";
import { queuedBytes } from "./queued";

/// The `ws` send options this route reads, resolved once per call.
///
/// `binary` and `fin` are both read here rather than at the call site because the
/// codec path used to ignore both, and both are wrong on the wire rather than absent:
/// `send(buffer, { binary: false })` framed a binary message where `ws` frames text,
/// and `send(data, { fin: false })` framed a complete message with the `fin` bit set.
/// Neither produced an error, and both are the sort of divergence an application
/// ships with and only finds against a peer that speaks the protocol correctly.
export type FrameOptions = {
  readonly binary: boolean;
  readonly fin: boolean;
};

/// Frames one message and writes it, for a socket the codec owns.
///
/// A separate module from the staging path because its statuses are the codec's
/// rather than the engine's, and the two vocabularies are not interchangeable: a
/// `backpressure` from the codec is a full event queue on one connection, while the
/// engine's is a full ring across a server.
export function sendFramed(
  state: SocketState,
  payload: SocketPayload,
  options: unknown,
  callback: unknown,
): void {
  const framing = frameOptions(options, payload.binary);
  // RFC 6455 section 5.4: the first frame of a fragmented message carries the data
  // opcode, and every frame after it carries opcode 0. Choosing the opcode from
  // whether the socket is mid-message is what makes the `fin` option a real
  // fragmentation rather than two messages.
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
  // Latched on success only, so a refused send leaves the message open exactly as it
  // was and the caller may retry or finish it.
  if (status === "ok") state.fragmentsOpen = !framing.fin;
  switch (status) {
    case "ok":
      // Re-read rather than zeroed: `ws` reports the sender's queue length, and a
      // transport that is still draining holds the bytes it was handed. Zeroing it here
      // would report a socket with a megabyte queued as idle, which is the one number
      // a caller polls to decide whether to stop sending.
      state.bufferedAmount = queuedBytes(state);
      defer(callback);
      return;
    case "backpressure":
    case "closing":
    case "closed":
      // Not a failure: `ws` reports these through the callback and leaves the socket
      // alone, because a send that arrived too late is not a fault of the socket.
      state.bufferedAmount = queuedBytes(state);
      defer(callback, notOpenError(state.readyState));
      return;
    case "invalid-handle":
    case "payload-too-large":
    case "protocol-error":
      reportFailure(state, callback, frameError(status));
      return;
  }
  // Every case returns, so this is the compile-time proof that a new status is
  // handled rather than ignored: adding a member to the union makes it a type error.
  throw unhandledFrameStatus(status);
}

/// Whether this frame may carry a compressed payload.
///
/// Four conditions, and each one is a rule rather than a preference. The connection
/// must have negotiated the extension, or RSV1 is a protocol error. The message must be
/// complete, because a one-shot compressor cannot produce the sync flush that a
/// fragmented message's later frames would need to continue the same stream -- and `ws`
/// does compress those, so this is a documented subset: a fragmented message goes out
/// uncompressed, which every peer reads. And the payload must reach the negotiated
/// threshold, `ws`'s `permessage-deflate.js:56-57` default of 1024 bytes, below which
/// deflate makes a message longer more often than not.
function mayCompress(state: SocketState, fin: boolean, length: number): boolean {
  if (!state.compressible || state.fragmentsOpen || !fin) return false;
  return length >= state.threshold;
}

/// The opcode and the `fin` bit, each defaulting to the autodetected value `ws`
/// documents. An out-of-type value is ignored rather than coerced, which is what
/// `ws` does with `opts.binary` and what a caller passing `undefined` expects.
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
