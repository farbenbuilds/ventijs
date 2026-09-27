import type { SocketState } from "../../types/socket";
import { isValidControlPayload } from "../../protocol/close-codes";
import { createError } from "../errors";
import { CONNECTING, OPEN } from "../ready-state";
import { defer, notOpenError, toPayload } from "./payload";

/// Normalizes `ping`/`pong` arguments the way `ws` does, then refuses a payload
/// RFC 6455 §5.5 cannot carry in a control frame.
///
/// The engine stages text, binary, and close frames today; control-frame staging
/// lands with the ping/pong binding, so an open socket reports the missing
/// transport through its callback instead of silently dropping the frame.
///
/// The length check throws rather than reporting through the callback, because
/// `ws` throws: `websocket.ping` reaches `sender.ping` synchronously on an open
/// socket and the byte length is validated there. It sits after the
/// not-OPEN branch for the same reason, since `ws` routes a closing or closed
/// socket to `sendAfterClose` without ever building a frame. Without it a staged
/// control frame would be an RFC violation the moment the transport lands.
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
    state.bufferedAmount += toPayload(payload).bytes.length;
    defer(failure, notOpenError(state.readyState));
    return;
  }
  if (!isValidControlPayload(toPayload(payload).bytes)) {
    throw createError(
      "ERR_INVALID_OPTION",
      "The data size must not be greater than 125 bytes",
      RangeError,
    );
  }
  defer(
    failure,
    createError("ERR_INVALID_STATE", `ventijs: ${kind} frames are not implemented yet`),
  );
}
