import { closeSocket } from "../../binding/socket";
import { CLOSE_ABNORMAL, CLOSE_NORMAL, isValidStatusCode } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { toCloseReason } from "./close-reason";
import { armCloseTimeout, closeFramed } from "./codec-close";
import { bufferedAmountOf } from "./payload";
import { closeFailure } from "./close-failure";

const EMPTY = Buffer.alloc(0);

export function finishConnection(state: SocketState, code: number, reason: Buffer): void {
  if (state.readyState === CLOSED) return;
  // Dropped here because this is the only path to `CLOSED`, and a deadline that
  // outlived its socket would keep the process alive for no reason.
  if (state.closeTimer !== null) {
    clearTimeout(state.closeTimer);
    state.closeTimer = null;
  }
  state.readyState = CLOSED;
  state.closeCode = code;
  state.closeReason = reason;
  emitEvent(state, "close", code, reason);
}

/// Reports a failure and closes, matching `ws`'s `abortHandshake`: it latches
/// `CLOSING`, emits `error`, and only then emits `close`, so a listener reading
/// `readyState` during `error` sees `CLOSING` and a second failure produces no
/// second event. Reached by a `close` or `terminate` while still `CONNECTING`.
///
/// A send failure does not come here. See `reportWithoutClosing`.
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

/// Emits `error` once and leaves the socket exactly as it was.
///
/// `ws` is silent for a failed send: the write error reaches the caller's
/// callback, and the socket's own listener destroys the transport without
/// emitting on the `WebSocket`. A ventijs send on a socket with no callback
/// therefore has nothing to observe at all, and silence was the previous
/// behaviour here.
///
/// This is a deliberate divergence and it is narrow on purpose. It emits, because
/// a caller that cannot pass a callback would otherwise learn nothing; and it does
/// **not** close, because the condition it reports is a missing implementation
/// rather than a fault of the connection, so tearing the socket down would cost
/// the caller a live connection for a bug in the library.
export function reportWithoutClosing(state: SocketState, error: Error): void {
  if (state.errorEmitted) return;
  if (state.readyState === CLOSED) return;
  state.errorEmitted = true;
  emitEvent(state, "error", error);
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
  if (state.codec !== null) {
    closeFramed(state, closeCode, closeReason);
    armCloseTimeout(state, state.closeTimeout);
    return;
  }
  if (state.attachment === null) {
    closeUnattached(state);
    return;
  }
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

/// Completes a close on a socket with no native attachment.
///
/// The latch above has already moved the socket to `CLOSING`, so this path must
/// always reach `CLOSED` on its own. Returning without doing anything stranded
/// the socket at `CLOSING` for the life of the process: no close frame went out,
/// the transport stayed open, and nothing else could complete the socket because
/// the transport's own `close` event is the only other door out. A caller that
/// called `close()` and then read `readyState` saw a socket that would never
/// close again, with no error and no event to explain it.
///
/// Until the Zig frame codec owns the upgrade route there is no close frame to
/// write, so the transport is destroyed and the socket finishes through the
/// transport's `close` event. The socket then reports `1006`, which is what a
/// close whose handshake never completed deserves. The caller asked to close, the
/// ready state reaches `CLOSED`, and `close` fires exactly once.
function closeUnattached(state: SocketState): void {
  if (state.transport === null) {
    finishConnection(state, CLOSE_ABNORMAL, EMPTY);
    return;
  }
  state.transport.destroy();
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
