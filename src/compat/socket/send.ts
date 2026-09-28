import { sendSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { CONNECTING, OPEN } from "../ready-state";
import { sendFramed } from "./codec-send";
import { reportWithoutClosing } from "./lifecycle";
import { notAttachedError, reportFailure } from "./send-failure";
import { defer, notOpenError, statusError, toPayload } from "./payload";

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
    // `sendAfterClose`: the bytes are accounted and the callback is told, nothing
    // else. Routing this through `reportFailure` would close a merely mid-close socket.
    defer(failure, notOpenError(state.readyState));
    return;
  }
  if (state.codec !== null) {
    // The codec frames for a socket that has a transport, so a message goes out as a
    // frame rather than as bytes the engine would have to frame.
    sendFramed(state, payload, options, failure);
    return;
  }
  if (state.attachment === null) {
    // Not `reportFailure`: the failure is this build's missing transport, not the
    // socket's, so only the observation differs from `ws`.
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

/// `ws` treats a function in the options position as the callback.
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
      // The engine says the connection is gone, so this is `sendAfterClose`.
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
      return;
  }
  // `unhandledStatus` takes `never`: a new `EngineStatus` member turns this into a type
  // error rather than a silent no-op on a status the send path has never seen.
  throw unhandledStatus(status);
}

function unhandledStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventijs: the engine reported an unknown socket status "${String(status)}"`,
  );
}
