import { sendSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { CONNECTING, OPEN } from "../ready-state";
import { reportWithoutClosing } from "./lifecycle";
import { notAttachedError, reportFailure } from "./send-failure";
import { bufferedAmountOf, defer, notOpenError, statusError, toPayload } from "./payload";

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
    accountUnsentBytes(state, payload.bytes.length);
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

/// Accumulates bytes that were accepted but will never reach the network.
///
/// `ws` splits this on whether a sender exists, and the split matters here. With
/// a sender the bytes are accounted against the socket's write queue, which
/// drains. Without one there is no queue to account against, so the counter only
/// ever grew: a send on a closing socket from the upgrade route raised
/// `bufferedAmount` by the payload size, nothing ever decremented it, and a
/// caller polling the property in a close handler watched a number climb without
/// limit. A number that only rises is indistinguishable from a leak in the
/// caller's own accounting, so nothing is accounted when there is nothing to
/// account against.
function accountUnsentBytes(state: SocketState, length: number): void {
  if (state.attachment !== null) state.bufferedAmount += length;
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
      accountUnsentBytes(state, length);
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
  // Every case above returns, so reaching here means a new `EngineStatus` member
  // has no branch. `unhandledStatus` takes `never`, which is the compile-time
  // proof: adding a member to the union turns this call into a type error rather
  // than a silent no-op on a status the send path has never seen. A `void` return
  // type gives no exhaustiveness checking of its own, which is why
  // `close-failure.ts` earns the same guarantee by returning an `Error`.
  throw unhandledStatus(status);
}

function unhandledStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventijs: the engine reported an unknown socket status "${String(status)}"`,
  );
}
