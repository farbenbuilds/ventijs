import { CODEC_KINDS, type CodecKindName } from "../../binding/codec";
import { codecOutbound, encodeCodecFrame } from "../../binding/codec-encode";
import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { isWritable, noTransportError } from "./codec-handle";
import { statusError } from "./payload";

/// What framing one frame did, in the vocabulary the send path already switches on. The
/// codec reports a refusal as a negative ordinal; this is where that becomes a status.
/// The two vocabularies are the same set on purpose: a caller learning two error
/// vocabularies for one operation will handle only one.
export type FrameStatus =
  | "ok"
  | "backpressure"
  | "closing"
  | "closed"
  | "invalid-handle"
  | "payload-too-large"
  | "protocol-error";

function ordinalOf(kind: CodecKindName): number {
  return CODEC_KINDS.indexOf(kind);
}

/// The caller's own masking key, or empty for the engine to draw one. Reused rather than
/// allocated per frame, because `generateMask` runs before every masked frame. A server
/// never masks, so `isServer` answers before the callback is asked, as in `ws`.
function maskFor(state: SocketState): Uint8Array {
  if (state.isServer || state.generateMask === null) return NO_MASK;
  state.generateMask(state.maskScratch);
  return state.maskScratch;
}

const NO_MASK = new Uint8Array(0);

/// Frames one message and writes it. A server does not mask, so the role is decided by
/// the codec rather than the caller: a masked frame from a server is a protocol error a
/// peer may close on, and the only way not to send one is not to offer the choice.

// `fin` and `compress` are the caller's because a fragmented send is two calls and RSV1
// is a per-frame decision. RFC 7692 only allows RSV1 on the first frame of a data
// message, and a control frame or continuation asking for it is refused with 1002.
export function writeFrame(
  state: SocketState,
  kind: CodecKindName,
  payload: Buffer,
  fin = true,
  compress = false,
): FrameStatus {
  const handle = state.codec;
  if (handle === null) return "closed";
  if (!isWritable(state)) return state.transport?.writableEnded === true ? "closed" : "closing";
  const length = encodeCodecFrame(handle, ordinalOf(kind), fin, payload, compress, maskFor(state));
  if (length < 0) return encodeFailure(-length);
  const framed = codecOutbound(handle);
  if (state.transport === null) return "closed";
  state.transport.write(framed.subarray(0, length));
  return "ok";
}

/// A pong is not optional: RFC 6455 section 5.5.2 requires one, promptly.
export function writePong(state: SocketState, payload: Buffer): void {
  writeFrame(state, "pong", payload);
}

/// An absent `code` writes the *empty* close payload, which is what a peer reads as "no
/// status". Substituting 1000 claimed a shutdown the caller never stated and made 1005
/// unobservable from a ventijs peer.
export function writeCloseFrame(
  state: SocketState,
  code: number | undefined,
  reason: Buffer,
): void {
  if (state.closeFrameSent) return;
  const frame = closePayload(code, reason);
  if (writeFrame(state, "close", frame) !== "ok") return;
  state.closeFrameSent = true;
}

function closePayload(code: number | undefined, reason: Buffer): Buffer {
  if (code === undefined) return Buffer.alloc(0);
  const payload = Buffer.alloc(2 + reason.length);
  payload.writeUInt16BE(code, 0);
  reason.copy(payload, 2);
  return payload;
}

function encodeFailure(ordinal: number): FrameStatus {
  switch (ordinal) {
    case 1:
      return "protocol-error";
    case 2:
      return "payload-too-large";
    case 3:
      return "protocol-error";
    case 4:
      return "invalid-handle";
    default:
      return "protocol-error";
  }
}

export type FailureStatus = Exclude<FrameStatus, "ok">;

export function isTransient(status: FrameStatus): boolean {
  return status === "backpressure";
}

/// Typed to the failures rather than to `FrameStatus`, so a caller cannot ask for the
/// error behind an outcome that has none.
export function frameError(status: FailureStatus): Error {
  if (status === "closed" || status === "closing") return noTransportError();
  // The same code the engine's own backpressure uses, so handling one handles the other.
  if (status === "backpressure") {
    return createError("ERR_BACKPRESSURE", "ventijs: the codec's event queue is full");
  }
  return statusError(status);
}
