import type { CodecFailureName } from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { refuseFramed } from "./codec-close";
import { REFUSALS, type Refusal } from "./refusal-table";

/// What a refused frame looks like, for a failure name the table does not have.
///
/// The fall-through is the protocol error rather than a throw: this runs on the message
/// path, where the codec has already latched a refusal, and a throw here would cost an
/// exception for every frame a hostile peer chose to send.
export function refusalOf(failure: CodecFailureName): Refusal {
  return REFUSALS[failure] ?? REFUSALS.protocolError;
}

/// The reason a close code alone reports, for a caller holding nothing else.
export function failureReason(code: number): string {
  return refusalForCloseCode(code).reason;
}

/// The failure name a close code stands for, for a caller that has only the code.
///
/// The code is a coarser thing than the name: twelve faults close with a 1002. This is
/// the `ws` shape of that gap -- one name, the most common cause -- and both call sites
/// have already read the name and only fall back here if the handle went stale between
/// the two reads.
export function failureByCode(code: number): CodecFailureName {
  switch (code) {
    case 1007:
      return "invalidUtf8";
    case 1008:
      return "tooManyBufferedParts";
    case 1009:
      return "unsupportedMessageLength";
    default:
      return "protocolError";
  }
}

/// The refusal a bare close code maps to, for the paths that refuse for a reason of
/// their own rather than the codec's.
export function refusalForCloseCode(code: number): Refusal {
  switch (code) {
    case 1002:
      return REFUSALS.protocolError;
    case 1007:
      return REFUSALS.invalidUtf8;
    case 1008:
      return REFUSALS.tooManyBufferedParts;
    case 1009:
      return REFUSALS.unsupportedMessageLength;
    case 1010:
      return {
        closeCode: 1010,
        code: "ERR_PROTOCOL",
        reason: "mandatory extension",
        message: "Unsupported protocol version",
        ctor: RangeError,
      };
    default:
      return {
        closeCode: code,
        code: "ERR_PROTOCOL",
        reason: `close ${code}`,
        message: "Invalid WebSocket frame",
        ctor: RangeError,
      };
  }
}

/// Refuses a connection on the codec's own verdict.
///
/// The codec decides what a frame was worth; this decides what the socket does about it.
/// The failure name is the reason the application gets and the close code is the reason
/// the peer gets, and they are decided together in one table so they cannot disagree.
export function refuseByCodec(state: SocketState, failure: CodecFailureName): void {
  refuseFramed(state, refusalOf(failure));
}
