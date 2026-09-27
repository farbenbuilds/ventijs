import {
  CODEC_KINDS,
  codecOutbound,
  encodeCodecFrame,
  type CodecKindName,
} from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { isWritable, noTransportError } from "./codec-handle";
import { statusError } from "./payload";

/// What framing one frame did, in the vocabulary the send path already switches on.
///
/// The codec reports a refusal as a negative ordinal rather than a status name, and
/// this is where that becomes a status the rest of the facade can act on. The two
/// vocabularies are the same set on purpose: a caller that has to learn two error
/// vocabularies for one operation will eventually handle only one of them.
export type FrameStatus =
  | "ok"
  | "backpressure"
  | "closing"
  | "closed"
  | "invalid-handle"
  | "payload-too-large"
  | "protocol-error";

/// `encode` takes an ordinal, so a kind name is looked up rather than passed.
function ordinalOf(kind: CodecKindName): number {
  return CODEC_KINDS.indexOf(kind);
}

/// Frames one message and writes it.
///
/// A server does not mask, so the role is decided by the codec rather than by the
/// caller: a masked frame from a server is a protocol error a peer is entitled to
/// close on, and the only way to avoid sending one is not to offer the choice.
export function writeFrame(state: SocketState, kind: CodecKindName, payload: Buffer): FrameStatus {
  const handle = state.codec;
  if (handle === null) return "closed";
  if (!isWritable(state)) return state.transport?.writableEnded === true ? "closed" : "closing";
  const length = encodeCodecFrame(handle, ordinalOf(kind), true, payload);
  if (length < 0) return encodeFailure(-length);
  const framed = codecOutbound(handle);
  if (state.transport === null) return "closed";
  state.transport.write(framed.subarray(0, length));
  return "ok";
}

/// Writes a pong, which is not optional: RFC 6455 section 5.5.2 requires one,
/// promptly, whether or not an application ever asks for it.
export function writePong(state: SocketState, payload: Buffer): void {
  writeFrame(state, "pong", payload);
}

/// Writes a close frame, if the socket has not sent one already.
export function writeCloseFrame(state: SocketState, code: number, reason: Buffer): void {
  if (state.closeFrameSent) return;
  const frame = closePayload(code, reason);
  if (writeFrame(state, "close", frame) !== "ok") return;
  state.closeFrameSent = true;
}

/// The two code bytes and the reason, which is what a close frame carries.
function closePayload(code: number, reason: Buffer): Buffer {
  const payload = Buffer.alloc(2 + reason.length);
  payload.writeUInt16BE(code, 0);
  reason.copy(payload, 2);
  return payload;
}

/// The codec's refusal ordinals onto the facade's statuses.
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

/// Every status that is not a success, which is what a caller turns into an error.
export type FailureStatus = Exclude<FrameStatus, "ok">;

/// Whether a status is one the caller can retry, which is what decides if a send
/// waits for the transport or fails now.
export function isTransient(status: FrameStatus): boolean {
  return status === "backpressure";
}

/// The error a framing refusal reports, for the paths that carry no status of their
/// own. Typed to the failures rather than to `FrameStatus`, so a caller cannot ask
/// for the error behind an outcome that has none.
export function frameError(status: FailureStatus): Error {
  if (status === "closed" || status === "closing") return noTransportError();
  // A full queue is not a fault of the socket, and the engine's own backpressure
  // reports the same code, so a caller that handles one handles the other.
  if (status === "backpressure") {
    return createError("ERR_BACKPRESSURE", "ventijs: the codec's event queue is full");
  }
  return statusError(status);
}
