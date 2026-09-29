import { closeSocket } from "../../binding/socket";
import { CLOSE_ABNORMAL, CLOSE_NORMAL } from "../../protocol/close-codes";
import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, CONNECTING } from "../ready-state";
import { closeCodeOf } from "./close-code";
import { toCloseReason } from "./close-reason";
import { armCloseTimeout, closeFramed } from "./codec-close";
import { closeFailure } from "./close-failure";
import { socketStateOf } from "./state";

const EMPTY = Buffer.alloc(0);

/// Whether the close frame is on the wire: the point `ws` settles `_final` at, which
/// `Sender.close` reaches by ending its socket with the frame and the codec does not.
export function closeFrameWritten(socket: object): boolean {
  return socketStateOf(socket)?.closeFrameSent === true;
}

export function finishConnection(state: SocketState, code: number, reason: Buffer): void {
  if (state.readyState === CLOSED) return;
  // Dropped because this is the only path to `CLOSED`, and a deadline that outlived its
  // socket would keep the process alive for nothing.
  if (state.closeTimer !== null) {
    clearTimeout(state.closeTimer);
    state.closeTimer = null;
  }
  state.readyState = CLOSED;
  state.closeCode = code;
  state.closeReason = reason;
  emitEvent(state, "close", code, reason);
}

/// Reports a failure and closes, matching `ws`'s `abortHandshake`: it latches `CLOSING`,
/// emits `error`, then `close`, so a listener reading `readyState` during `error` sees
/// `CLOSING` and a second failure produces no second event. A send failure does not come
/// here; see `reportWithoutClosing`.
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

/// Emits `error` once and leaves the socket as it was. A deliberate divergence from
/// `ws`, which is silent for a failed send: the write error reaches the caller's callback
/// and a send with no callback has nothing to observe. It emits, because such a caller
/// would otherwise learn nothing, and it does **not** close, because the condition it
/// reports is a missing implementation rather than a fault of the connection.
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
  // The latch precedes validation because `ws` latches `CLOSING` first: a refused close
  // still leaves the socket closing, so a second close is a no-op, not a second attempt.
  state.readyState = CLOSING;
  // An absent code stays absent to the wire. `ws` writes an empty close payload and its
  // peer reports 1005, "no status received"; substituting 1000 asserted a shutdown the
  // caller never asked for. `closeCode` stays 1006 until a frame supplies one.
  const closeCode = closeCodeOf(code);
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
    // The engine's close always carries a code, so the absent-code rule does not reach
    // it. Unreachable from the public surface today; the clamp gives a real code anyway.
    closeCode ?? CLOSE_NORMAL,
    closeReason,
  );
  if (status === "ok") {
    state.closeFrameSent = true;
    return;
  }
  if (status === "closing" || status === "closed") {
    finishConnection(state, CLOSE_ABNORMAL, EMPTY);
    return;
  }
  failConnection(state, closeFailure(status));
}

/// Completes a close on a socket with no native attachment. The latch above has already
/// moved the socket to `CLOSING`, so this path must always reach `CLOSED` on its own:
/// returning early strands it at `CLOSING` for the life of the process, with no close
/// frame, an open transport, and no other door out but the transport's own `close`
/// event. Until the Zig frame codec owns the upgrade route there is no frame to write,
/// so the transport is destroyed and the socket reports `1006`.
function closeUnattached(state: SocketState): void {
  // Cancelled first, so a request in flight stops before `close` reports: otherwise the
  // socket closes while its request is still going to put a connection on the wire.
  state.cancelHandshake?.();
  if (state.transport === null) {
    finishConnection(state, CLOSE_ABNORMAL, EMPTY);
    return;
  }
  state.transport.destroy();
}
