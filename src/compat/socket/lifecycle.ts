import { closeSocket, pauseSocket, resumeSocket } from "../../binding/socket";
import { CLOSE_ABNORMAL, CLOSE_NORMAL, isValidStatusCode } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import type { EngineStatus } from "../../types/status";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { toCloseReason } from "./close-reason";
import { bufferedAmountOf, statusError } from "./payload";

const EMPTY = Buffer.alloc(0);

export function finishConnection(state: SocketState, code: number, reason: Buffer): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSED;
  state.closeCode = code;
  state.closeReason = reason;
  emitEvent(state, "close", code, reason);
}

/// Reports a failure on the socket and finishes the connection.
///
/// The latch is once per socket, matching `ws`'s `_errorEmitted`: a send that
/// failed once against a dead transport will fail again, and a listener that
/// re-sends would otherwise turn one fault into an unbounded stream of identical
/// events. The terminal transition is not latched here, only the reporting, so a
/// refused `close` still closes.
export function failConnection(state: SocketState, error: Error): void {
  if (state.readyState === CLOSED) return;
  // The terminal latch must run even when an unhandled `error` throws.
  try {
    if (!state.errorEmitted) {
      state.errorEmitted = true;
      emitEvent(state, "error", error);
    }
  } finally {
    finishConnection(state, CLOSE_ABNORMAL, EMPTY);
  }
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

/// Maps a rejected native close onto a coded error instead of leaving the
/// socket latched in CLOSING with no frame sent. Exhaustive over `EngineStatus`
/// so a new member cannot fall through to a generic message.
function closeFailure(status: EngineStatus): Error {
  switch (status) {
    case "backpressure":
      return createError("ERR_BACKPRESSURE", "ventijs: the outbound staging ring is full");
    case "invalid-handle":
      return createError("ERR_INVALID_HANDLE", "ventijs: the connection handle is stale");
    case "ok":
    case "closing":
    case "closed":
      return createError("ERR_INVALID_STATE", "ventijs: the connection is already closing");
    case "payload-too-large":
    case "invalid-close-code":
    case "invalid-close-reason":
    case "protocol-error":
    case "policy-violation":
      return statusError(status);
  }
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
