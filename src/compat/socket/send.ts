import { sendSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { failConnection } from "./lifecycle";
import { CONNECTING, OPEN } from "../ready-state";
import { bufferedAmountOf, defer, notOpenError, statusError, toPayload } from "./payload";

const NOT_ATTACHED =
  "ventijs: the socket has no native transport attached; engine socket adoption is not implemented yet";

/// Reports a failed send to the one channel the caller always has.
///
/// `ws` invokes the callback when one is given and emits `error` on the socket
/// when one is not, latched once so a second failure is not a second event.
/// Discarding the error instead left a caller with no signal at all: no callback,
/// no `error` event, and `readyState` unchanged.
function reportFailure(state: SocketState, callback: unknown, error: Error): void {
  if (typeof callback === "function") {
    defer(callback, error);
    return;
  }
  failConnection(state, error);
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
    state.bufferedAmount += payload.bytes.length;
    reportFailure(state, failure, notOpenError(state.readyState));
    return;
  }
  if (state.attachment === null) {
    reportFailure(state, failure, createError("ERR_INVALID_STATE", NOT_ATTACHED));
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
      state.bufferedAmount += length;
      reportFailure(state, callback, notOpenError(state.readyState));
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
