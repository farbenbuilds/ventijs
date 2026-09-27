import type { SocketState } from "../../types/socket";
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
      // Reached by a message split into more fragments than the compiled bound, and
      // by a policy refusal. `ws` says "Too many message fragments" for the first and
      // both carry 1008, so the socket's own reason is the one a caller can act on.
      return "too many message fragments";
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
