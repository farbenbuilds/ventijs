import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import { finishConnection } from "./lifecycle";

/// Sends a socket's close frame and leaves the rest of the handshake to the two
/// doors that already exist: the peer's close frame, or the transport's `close`.
///
/// The socket stays `CLOSING` in between, which is what `ws` does and what makes the
/// difference between a close that completed and one that did not observable. Ending
/// the connection from here would report 1006 for a handshake that is still in
/// flight, and reporting 1000 for one that never finished would be the reverse lie.
///
/// The codec is not released: it is released by whichever door finishes the socket,
/// and releasing it here would drop the close frame still in the transport's buffer.
export function closeFramed(state: SocketState, code: number, reason: Buffer): void {
  writeCloseFrame(state, code, reason);
}

/// Refuses a frame, telling the peer the code and reporting it to the application.
///
/// The close frame goes out first, because a connection refused without one is a
/// reset to the peer and a reset cannot carry a code: `ws` closes with 1009 for an
/// oversized message, and a peer that only ever saw the transport die reports 1006
/// and cannot tell a size limit from a crash. The socket's own `close` event then
/// reports the same code, so both sides agree on why.
///
/// `error` is emitted before `close`, as `ws` does, and inside a `finally` so a
/// listener that throws cannot leave the socket open.
export function refuseFramed(state: SocketState, code: number, reason: string): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSING;
  writeCloseFrame(state, code, Buffer.from(reason, "utf8"));
  try {
    if (!state.errorEmitted) {
      state.errorEmitted = true;
      emitEvent(
        state,
        "error",
        createError(
          "ERR_PROTOCOL",
          `ventijs: the peer sent a frame the protocol forbids (${reason})`,
        ),
      );
    }
  } finally {
    const reported = Buffer.from(reason, "utf8");
    finishConnection(state, code, reported);
    closeCodec(state);
    state.transport?.end();
  }
}
