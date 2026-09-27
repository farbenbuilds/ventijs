import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { CLOSE_ABNORMAL } from "../../protocol/close-codes";
import { failConnection, finishConnection } from "./lifecycle";

const EMPTY = Buffer.alloc(0);

/// Reports a terminal transport failure. The caller destroys the transport,
/// which produces the `close` event that finishes the socket, so this latches
/// `CLOSING` and emits without reaching `CLOSED` itself.
///
/// It deliberately ignores the `errorEmitted` latch that `failConnection` and
/// `reportWithoutClosing` guard. That latch exists so a *recoverable* report,
/// currently a failed send on a socket with no callback, cannot become a second
/// `error` on a socket that is still healthy. A transport failure is the
/// opposite: the connection is gone, it is the one event a caller with no
/// callback has to observe, and suppressing it behind an unrelated earlier
/// report is how a peer reset became a silent `close(1006)` with nothing in
/// between. `ws` emits `error` for a socket-level failure regardless of
/// `_errorEmitted` for the same reason.
export function failTransport(state: SocketState, error: Error): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSING;
  emitEvent(state, "error", error);
}

/// Forcibly closes the socket by destroying the transport.
///
/// The latch precedes the destroy, matching `ws`: a terminated socket is
/// observably `CLOSING` until the transport's `close` event finishes it, and a
/// socket left `OPEN` after `terminate()` is a second call's opportunity to send
/// on a connection that is already gone.
export function terminateConnection(state: SocketState): void {
  if (state.readyState === CLOSED) return;
  if (state.readyState === CONNECTING) {
    failConnection(
      state,
      createError(
        "ERR_INVALID_STATE",
        "WebSocket was closed before the connection was established",
      ),
    );
    return;
  }
  state.readyState = CLOSING;
  if (state.transport !== null) {
    state.transport.destroy();
    return;
  }
  finishConnection(state, CLOSE_ABNORMAL, EMPTY);
}
