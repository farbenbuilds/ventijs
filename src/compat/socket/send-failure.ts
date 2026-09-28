import type { SocketState } from "../../types/socket";
import { createError } from "../errors";
import { defer } from "./payload";
import { reportWithoutClosing } from "./lifecycle";

const NOT_ATTACHED =
  "ventijs: the socket has no native transport attached; engine socket adoption is not implemented yet";

export function notAttachedError(): Error {
  return createError("ERR_INVALID_STATE", NOT_ATTACHED);
}

/// `ws` splits this three ways and only two are reachable from a public ventijs socket:
/// `CONNECTING` throws out of `send`, and not-`OPEN` goes to `sendAfterClose`, where the
/// bytes are accounted, the callback is told, and no `error`, no close, and no
/// `readyState` change, so a caller sending during a close in progress does not have its
/// socket taken away.

// On an open socket with no callback there is nothing to observe, so `error` is
// emitted, latched once, and deliberately **without** closing. The socket is not at
// fault, the implementation is incomplete, and tearing it down would turn "this build
// cannot send" into "your connection died".
export function reportFailure(state: SocketState, callback: unknown, error: Error): void {
  if (typeof callback === "function") {
    defer(callback, error);
    return;
  }
  reportWithoutClosing(state, error);
}
