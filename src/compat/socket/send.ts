import { sendSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { reportWithoutClosing } from "./lifecycle";
import { CONNECTING, OPEN } from "../ready-state";
import { bufferedAmountOf, defer, notOpenError, statusError, toPayload } from "./payload";

const NOT_ATTACHED =
  "ventijs: the socket has no native transport attached; engine socket adoption is not implemented yet";

function notAttachedError(): Error {
  return createError("ERR_INVALID_STATE", NOT_ATTACHED);
}

/// Reports a failed send, and decides whether it also tears the socket down.
///
/// `ws` splits this three ways and only two of them are reachable from a public
/// ventijs socket:
///
/// - CONNECTING throws out of `send`, before anything else.
/// - Not `OPEN` goes to `sendAfterClose`: the bytes are accounted, the callback
///   is told, and nothing else happens. No `error`, no close, `readyState`
///   untouched, so a caller sending during a close already in progress does not
///   have its socket taken away from it.
/// - `OPEN` goes to the sender. A write failure reaches the caller's callback,
///   and the socket's own `error` listener (`socketOnError`) latches `CLOSING`
///   and destroys the transport. `ws` emits **nothing** on the `WebSocket` for a
///   send failure, so the honest position is that ventijs is stricter here, and
///   that the two places it can be stricter are the two below.
///
/// On an open socket with no callback there is nothing to observe, and silence
/// was the previous behaviour: the caller had no channel at all. So `error` is
/// emitted, latched once, and deliberately **without** closing. The socket is
/// not at fault, the implementation is incomplete, and tearing it down would
/// turn "this build cannot send" into "your connection died" for every caller
/// that writes before the native transport exists.
function reportFailure(state: SocketState, callback: unknown, error: Error): void {
  if (typeof callback === "function") {
    defer(callback, error);
    return;
  }
  reportWithoutClosing(state, error);
}

export function sendData(
  state: SocketState,
  data: unknown,
  options: unknown,
  callback: unknown,
): void {
  if (state.readyState === CONNECTING) throw notOpenError(CONNECTING);
  const payload = toPayload(data);
  const failure = resolveCallback(options, callback);
  if (state.readyState !== OPEN) {
    // `sendAfterClose`: the bytes are accounted and the callback is told, and
    // nothing else happens. Routing this through `reportFailure` would close a
    // socket that was merely mid-close.
    state.bufferedAmount += payload.bytes.length;
    defer(failure, notOpenError(state.readyState));
    return;
  }
  if (state.attachment === null) {
    // Not `reportFailure`: the failure is this build's missing transport, not a
    // fault of the socket, so the socket is left usable and only the observation
    // differs from `ws`.
    if (typeof failure === "function") defer(failure, notAttachedError());
    else reportWithoutClosing(state, notAttachedError());
    return;
  }
  const binary = sendBinary(options, payload.binary);
  const status = sendSocket(
    state.attachment.server,
    state.attachment.connection,
    payload.bytes,
    binary,
  );
  applySendStatus(state, status, payload.bytes.length, failure);
}

/// `ws` treats a function in the options position as the callback, so the
/// options object never doubles as the callback slot.
function resolveCallback(options: unknown, callback: unknown): unknown {
  if (typeof options === "function") return options;
  return callback;
}

function sendBinary(options: unknown, fallback: boolean): boolean {
  if (typeof options !== "object" || options === null) return fallback;
  const binary = (options as { binary?: unknown }).binary;
  return typeof binary === "boolean" ? binary : fallback;
}

function applySendStatus(
  state: SocketState,
  status: EngineStatus,
  length: number,
  callback: unknown,
): void {
  switch (status) {
    case "ok":
      state.bufferedAmount = bufferedAmountOf(state);
      defer(callback);
      return;
    case "backpressure":
      reportFailure(
        state,
        callback,
        createError("ERR_BACKPRESSURE", "ventijs: the outbound staging ring is full"),
      );
      return;
    case "closing":
    case "closed":
      // The engine says the connection is gone, so this is `sendAfterClose` and
      // not a send failure: the bytes are accounted and the caller is told.
      state.bufferedAmount += length;
      defer(callback, notOpenError(state.readyState));
      return;
    case "invalid-handle":
      reportFailure(
        state,
        callback,
        createError("ERR_INVALID_HANDLE", "ventijs: the connection handle is stale"),
      );
      return;
    case "payload-too-large":
    case "invalid-close-code":
    case "invalid-close-reason":
    case "protocol-error":
    case "policy-violation":
      reportFailure(state, callback, statusError(status));
  }
}
