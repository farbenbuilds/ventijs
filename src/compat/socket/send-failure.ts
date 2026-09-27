import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { defer } from "./payload";
import { reportWithoutClosing } from "./lifecycle";

const NOT_ATTACHED =
  "ventijs: the socket has no native transport attached; engine socket adoption is not implemented yet";

export function notAttachedError(): Error {
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
export function reportFailure(state: SocketState, callback: unknown, error: Error): void {
  if (typeof callback === "function") {
    defer(callback, error);
    return;
  }
  reportWithoutClosing(state, error);
}
