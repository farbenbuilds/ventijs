import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { codecOf } from "./codec-handle";
import { refuseFramed } from "./codec-close";

/// Why the codec refused, in the words the close code already uses, so the error an
/// application sees and the code its peer sees are the same sentence.
export function failureReason(code: number): string {
  switch (code) {
    case 1002:
      return "protocol error";
    case 1007:
      return "invalid payload";
    case 1008:
      return "policy violation";
    case 1009:
      return "message too big";
    case 1010:
      return "mandatory extension";
    default:
      return `close ${code}`;
  }
}

/// Refuses a connection on the codec's own verdict, with the code it latched.
///
/// The codec decides what a frame was worth; this decides what the socket does about
/// it. Keeping the two apart is what lets the reason be replaced without touching the
/// decoder, and the decoder replaced without inventing a policy.
export function refuseByCodec(state: SocketState, code: number): void {
  refuseFramed(state, code, failureReason(code));
}

/// The latched close code, or a protocol error when the codec is already gone.
///
/// A socket with no codec has nothing to have refused, so reporting 1002 rather than
/// throwing keeps a teardown path from failing on a race it did not cause.
export function latchedCode(state: SocketState): number {
  if (codecOf(state) === null) return 1002;
  throw createError("ERR_INVALID_STATE", "ventijs: the socket has no codec");
}
