import { closeSocket, pauseSocket, resumeSocket } from "../../binding/socket";
import { CLOSE_ABNORMAL, CLOSE_NORMAL, isValidStatusCode } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { toCloseReason } from "./close-reason";
import { bufferedAmountOf } from "./payload";
import { closeFailure } from "./close-failure";

const EMPTY = Buffer.alloc(0);

export function finishConnection(state: SocketState, code: number, reason: Buffer): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSED;
  state.closeCode = code;
  state.closeReason = reason;
  emitEvent(state, "close", code, reason);
}

/// Reports a failure and closes, matching `ws`'s `emitErrorAndClose`.
///
/// The order is the point. `ws` sets `CLOSING`, latches `_errorEmitted`, emits
/// `error`, and only then emits `close`, so a listener reading `readyState`
/// during `error` sees `CLOSING` and a second failure produces no second event.
/// This is the path for a send that failed on an *open* socket, which is the only
/// place `ws` emits at all: a send on a socket that is already closing or closed
/// goes to its callback and touches nothing else.
export function failConnection(state: SocketState, error: Error): void {
  if (state.readyState === CLOSED) return;
  if (!state.errorEmitted) {
    state.errorEmitted = true;
    state.readyState = CLOSING;
    // The terminal latch must run even when an unhandled `error` throws.
    try {
      emitEvent(state, "error", error);
    } finally {
      finishConnection(state, CLOSE_ABNORMAL, EMPTY);
    }
    return;
  }
  finishConnection(state, CLOSE_ABNORMAL, EMPTY);
}

export function closeConnection(state: SocketState, code?: unknown, reason?: unknown): void {
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
  if (state.readyState === CLOSING) return;
  // The latch precedes validation because `ws` latches `CLOSING` before it
  // validates: a close it refuses still leaves the socket closing, so a second
  // close is a no-op rather than a second attempt. Validating first left every
  // refused close on an `OPEN` socket that would accept it again.
  state.readyState = CLOSING;
  const closeCode = code === undefined ? CLOSE_NORMAL : Math.trunc(assertCloseCode(code));
  const closeReason = toCloseReason(reason);
  if (state.attachment === null) return;
  const status = closeSocket(
    state.attachment.server,
    state.attachment.connection,
    closeCode,
    closeReason,
  );
  if (status === "ok") {
    state.closeFrameSent = true;
    state.bufferedAmount = bufferedAmountOf(state);
    return;
  }
  if (status === "closing" || status === "closed") {
    finishConnection(state, CLOSE_ABNORMAL, EMPTY);
    return;
  }
  failConnection(state, closeFailure(status));
}

function assertCloseCode(code: unknown): number {
  if (typeof code !== "number" || !isValidStatusCode(code)) {
    throw createError(
      "ERR_INVALID_CLOSE_CODE",
      "First argument must be a valid error code number",
      TypeError,
    );
  }
  return code;
}

export function pauseConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = true;
  if (state.attachment === null) return;
  pauseSocket(state.attachment.server, state.attachment.connection);
}

export function resumeConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = false;
  if (state.attachment === null) return;
  resumeSocket(state.attachment.server, state.attachment.connection);
}

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
  // The latch precedes the destroy, matching `ws`: a terminated socket is
  // observably `CLOSING` until the transport's `close` event finishes it, and a
  // socket left `OPEN` after `terminate()` is a second call's opportunity to send
  // on a connection that is already gone.
  state.readyState = CLOSING;
  if (state.transport !== null) {
    state.transport.destroy();
    return;
  }
  finishConnection(state, CLOSE_ABNORMAL, EMPTY);
}
