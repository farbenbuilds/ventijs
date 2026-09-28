import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, OPEN } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import type { Refusal } from "./refusal-table";
import { finishConnection } from "./lifecycle";

const CLOSE_ABNORMAL = 1006;

/// Sends a socket's close frame and arms the deadline the handshake is bounded by.
///
/// The socket stays `CLOSING` in between, which is what `ws` does and what makes the
/// difference between a close that completed and one that did not observable. Ending
/// the connection from here would report 1006 for a handshake that is still in flight,
/// and reporting 1000 for one that never finished would be the reverse lie.
///
/// The codec is not released: it is released by whichever door finishes the socket,
/// and releasing it here would drop the close frame still in the transport's buffer.
export function closeFramed(state: SocketState, code: number | undefined, reason: Buffer): void {
  writeCloseFrame(state, code, reason);
}

/// Refuses a frame, telling the peer the code and reporting it to the application.
///
/// The close frame goes out first, because a connection refused without one is a reset
/// to the peer and a reset cannot carry a code. `error` is emitted before `close`, as
/// `ws` does, and inside a `finally` so a listener that throws cannot leave the socket
/// open.
export function refuseFramed(state: SocketState, refusal: Refusal): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSING;
  writeCloseFrame(state, refusal.closeCode, Buffer.from(refusal.reason, "utf8"));
  try {
    if (!state.errorEmitted) {
      state.errorEmitted = true;
      emitEvent(state, "error", createError(refusal.code, refusal.message, refusal.ctor));
    }
  } finally {
    finishConnection(state, refusal.closeCode, Buffer.from(refusal.reason, "utf8"));
    closeCodec(state);
    state.transport?.end();
  }
}

/// Arms the deadline on a close handshake, and tears the socket down when it expires.
///
/// Without it a peer that receives a close frame and never answers one leaves the
/// socket at `CLOSING` for the life of the process, holding its transport and its
/// codec slot. `ws` bounds the same wait with `closeTimeout`; the default here is the
/// same thirty seconds.
///
/// Zero is "tear down on the next tick", which is what `setTimeout(fn, 0)` does in
/// `ws` and what a caller who wrote `closeTimeout: 0` asked for. Treating it as "no
/// deadline" turned a bounded teardown into a permanent hold: the socket sat at
/// `CLOSING` forever, with its transport and its codec slot still checked out, and a
/// `ws` caller running the same configuration saw a clean 1006 milliseconds later.
///
/// The expiry path is a `terminate` rather than a bare `close`: the peer is not
/// answering, so the frame will never be read, and holding the descriptor open for
/// another thirty seconds would be trading one leak for a slower one.
export function armCloseTimeout(state: SocketState, milliseconds: number): void {
  clearCloseTimeout(state);
  state.closeTimer = setTimeout(
    () => {
      state.closeTimer = null;
      if (state.readyState !== CLOSING) return;
      state.transport?.destroy();
      finishConnection(state, CLOSE_ABNORMAL, Buffer.alloc(0));
    },
    Math.max(milliseconds, 0),
  );
  // A pending close timer must not be the reason a process stays up, which is what
  // `setTimeout` does by default and what a socket library has no business deciding.
  state.closeTimer.unref?.();
}

/// Drops a pending deadline, for the paths that finish a socket on their own.
export function clearCloseTimeout(state: SocketState): void {
  if (state.closeTimer === null) return;
  clearTimeout(state.closeTimer);
  state.closeTimer = null;
}

/// Whether a socket is open enough to be closed by a frame, which is the state a
/// close deadline is only meaningful in.
export function isClosing(state: SocketState): boolean {
  return state.readyState === CLOSING || state.readyState === OPEN;
}
