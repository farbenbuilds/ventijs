import type { SocketState } from "../../types/socket";
import { isValidControlPayload } from "../../protocol/close-codes";
import { createError } from "../errors";
import { CONNECTING, OPEN } from "../ready-state";
import { frameError, writeFrame } from "./codec-outbound";
import { defer, notOpenError, toPayload } from "./payload";

/// Normalizes `ping`/`pong` arguments the way `ws` does, frames the control frame,
/// and refuses a payload RFC 6455 §5.5 cannot carry.
///
/// The length check throws rather than reporting through the callback, because
/// `ws` throws: `websocket.ping` reaches `sender.ping` synchronously on an open
/// socket and the byte length is validated there. It sits after the not-OPEN branch
/// for the same reason, since `ws` routes a closing or closed socket to
/// `sendAfterClose` without ever building a frame. Without it a control frame over
/// 125 bytes would be an RFC violation on the wire.
export function controlFrame(
  state: SocketState,
  kind: "ping" | "pong",
  data: unknown,
  mask: unknown,
  callback: unknown,
): void {
  if (state.readyState === CONNECTING) throw notOpenError(CONNECTING);
  let payload = data;
  let failure = callback;
  if (typeof payload === "function") {
    failure = payload;
    payload = undefined;
  } else if (typeof mask === "function") {
    failure = mask;
  }
  if (typeof payload === "number") payload = String(payload);
  if (state.readyState !== OPEN) {
    defer(failure, notOpenError(state.readyState));
    return;
  }
  const bytes = toPayload(payload).bytes;
  if (!isValidControlPayload(bytes)) {
    throw createError(
      "ERR_INVALID_OPTION",
      "The data size must not be greater than 125 bytes",
      RangeError,
    );
  }
  const status = writeFrame(state, kind, bytes);
  if (status === "ok") {
    defer(failure);
    return;
  }
  defer(failure, frameError(status));
}
