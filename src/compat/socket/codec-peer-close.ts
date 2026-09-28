/// The peer's close frame: answer it, then finish. The one event that decides the
/// socket's future rather than reporting on its traffic, and the one that has to be
/// right about ordering.

import type { CodecEvent } from "../../binding/codec";
import { CLOSE_NO_STATUS } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { CLOSING } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import { finishConnection } from "./lifecycle";

/// `ws` echoes a close frame it did not send one for, and the socket's own close code is
/// the peer's, so a clean close reports the peer's code rather than 1006 for a handshake
/// that did happen. A close with no code reports 1005, "no status received", which is
/// what RFC 6455 section 7.1.5 assigns it; reporting 1006 instead claimed a transport
/// failure and made 1005 unobservable on either route.
export function closeFromPeer(state: SocketState, event: CodecEvent): void {
  if (state.readyState !== CLOSING) state.readyState = CLOSING;
  state.closeFrameReceived = true;
  if (!state.closeFrameSent) {
    // The echo carries the peer's own code: an empty close frame would report 1005 and
    // read as a protocol fault. A peer that sent no code gets none back.
    writeCloseFrame(state, event.code === 0 ? undefined : event.code, event.payload);
  }
  finishConnection(state, event.code === 0 ? CLOSE_NO_STATUS : event.code, event.payload);
  // Ended, as in `ws`, so a clean close does not leave a socket on an idle connection.
  closeCodec(state);
  state.transport?.end();
}
