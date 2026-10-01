import type { SocketState } from "../../types/socket";
import { logSocketError } from "../../logging/lifecycle";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { CLOSE_ABNORMAL } from "../../protocol/close-codes";
import { failConnection, finishConnection } from "./lifecycle";

const EMPTY = Buffer.alloc(0);

/// Reports a terminal transport failure. The caller destroys the transport, whose `close`
/// event finishes the socket, so this latches `CLOSING` and emits without reaching
/// `CLOSED` itself. It deliberately ignores the `errorEmitted` latch `failConnection`
/// guards, which stops a *recoverable* report becoming a second `error`: a transport
/// failure is the one event a caller with no callback must observe, and `ws` emits
/// `error` for a socket-level failure regardless of `_errorEmitted`.
export function failTransport(state: SocketState, error: Error): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSING;
  logSocketError(state, error);
  emitEvent(state, "error", error);
}

/// The latch precedes the destroy, matching `ws`: a terminated socket is observably
/// `CLOSING` until the transport's `close` event finishes it, and a socket left `OPEN`
/// is a second call's opportunity to send on a connection that is already gone.
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
