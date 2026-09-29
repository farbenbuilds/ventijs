import type { SocketState } from "../../types/socket";
import { isValidControlPayload } from "../../protocol/close-codes";
import { createError } from "../errors";
import { CONNECTING, OPEN } from "../ready-state";
import { frameError, writeFrame } from "./codec-outbound";
import { defer, notOpenError, toPayload } from "./payload";

/// The length check throws rather than reporting through the callback, because `ws`
/// throws: `websocket.ping` reaches `sender.ping` synchronously on an open socket and the
/// length is validated there. It sits after the not-OPEN branch for the same reason, and
/// without it a control frame over 125 bytes would be an RFC 6455 section 5.5 violation
/// on the wire.
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
    mask = undefined;
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
  // `ping(data, mask, cb)`, as in `ws`: a client that asks for an unmasked control frame gets
  // one. A server still refuses, which `codec-outbound.ts` owns.
  const status = writeFrame(state, kind, bytes, true, false, mask !== false);
  if (status === "ok") {
    defer(failure);
    return;
  }
  defer(failure, frameError(status));
}
