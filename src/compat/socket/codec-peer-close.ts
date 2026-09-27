//! The peer's close frame: answer it, then finish.
//!
//! Its own module because a close is the one event that decides the socket's future
//! rather than reporting on its traffic, and it is the one that has to be right about
//! ordering: a peer that writes a message and a close in the same read means it, and
//! the message has to reach the application before the connection ends.

import type { CodecEvent } from "../../binding/codec";
import { CLOSE_NO_STATUS } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { CLOSING } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import { finishConnection } from "./lifecycle";

/// The peer's close frame: answer it, then finish.
///
/// `ws` echoes a close frame it did not send one for, and the socket's own close code
/// is the peer's, so a clean close reports the code the peer chose rather than 1006 for
/// a handshake that did happen.
///
/// A close frame with no code reports 1005, "no status received", which is what RFC
/// 6455 section 7.1.5 assigns it and what `ws` surfaces. Reporting 1006 instead said
/// the transport had failed, which is a claim about a connection that ended by exactly
/// the agreed handshake, and it made 1005 impossible to observe on either route.
export function closeFromPeer(state: SocketState, event: CodecEvent): void {
  if (state.readyState !== CLOSING) state.readyState = CLOSING;
  state.closeFrameReceived = true;
  if (!state.closeFrameSent) {
    // The echo carries the peer's own code, which is what a clean shutdown needs: an
    // empty close frame would report 1005 and read as a protocol fault. A peer that
    // sent no code gets none back, which is the same rule applied in reverse.
    writeCloseFrame(state, event.code === 0 ? undefined : event.code, event.payload);
  }
  finishConnection(state, event.code === 0 ? CLOSE_NO_STATUS : event.code, event.payload);
  // The handshake is over, so the transport is ended rather than left for a peer
  // that has already said everything it is going to. `ws` does the same, and it is
  // what stops a socket sitting on an idle connection after a clean close.
  closeCodec(state);
  state.transport?.end();
}
