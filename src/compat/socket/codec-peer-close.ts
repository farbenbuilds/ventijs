/// The peer's close frame: answer it, then finish, in that order.

import type { CodecEvent } from "../../binding/codec";
import { CLOSE_NO_STATUS } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { CLOSING } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import { finishConnection } from "./lifecycle";

/// `ws` echoes a close frame it did not send one for, and the socket's close code is the peer's,
/// so a code-less close reports 1005, "no status received" (RFC 6455 section 7.1.5), not 1006.
export function closeFromPeer(state: SocketState, event: CodecEvent): void {
  if (state.readyState !== CLOSING) state.readyState = CLOSING;
  state.closeFrameReceived = true;
  if (!state.closeFrameSent) {
    // The echo carries the peer's own code: an empty close frame would report 1005 and read
    // as a protocol fault. A peer that sent no code gets none back.
    writeCloseFrame(state, event.code === 0 ? undefined : event.code, event.payload);
  }
  finishConnection(state, event.code === 0 ? CLOSE_NO_STATUS : event.code, event.payload);
  // Ended, as in `ws`, so a clean close does not leave a socket on an idle connection.
  closeCodec(state);
  state.transport?.end();
}
