import { createError } from "../errors";
import { noTransportError } from "./codec-handle";
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

export type FailureStatus = Exclude<FrameStatus, "ok">;

/// The encode-failure ordinals mirror `CODEC_ENCODE_FAILURES` in `codec-status.ts`.
export function encodeFailure(ordinal: number): FrameStatus {
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

export function isTransient(status: FrameStatus): boolean {
  return status === "backpressure";
}

/// Typed to the failures rather than to `FrameStatus`, so a caller cannot ask for the
/// error behind an outcome that has none.
export function frameError(status: FailureStatus): Error {
  if (status === "closed" || status === "closing") return noTransportError();
  // The same code the engine's own backpressure uses, so handling one handles the other.
  if (status === "backpressure") {
    return createError("ERR_BACKPRESSURE", "ventiws: the codec's event queue is full");
  }
  return statusError(status);
}
