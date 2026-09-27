import { createError } from "../errors";
import type { SocketState } from "../../types/socket";
import { defer, notOpenError, type SocketPayload } from "./payload";
import { frameError, writeFrame } from "./codec-outbound";
import { reportFailure } from "./send-failure";

/// Frames one message and writes it, for a socket the codec owns.
///
/// A separate module from the staging path because its statuses are the codec's
/// rather than the engine's, and the two vocabularies are not interchangeable: a
/// `backpressure` from the codec is a full event queue on one connection, while the
/// engine's is a full ring across a server.
export function sendFramed(state: SocketState, payload: SocketPayload, callback: unknown): void {
  const status = writeFrame(state, payload.binary ? "binary" : "text", payload.bytes);
  switch (status) {
    case "ok":
      // A framed write reaches the transport synchronously, so the bytes are already
      // accounted for by the time the callback runs and there is nothing to add.
      state.bufferedAmount = 0;
      defer(callback);
      return;
    case "backpressure":
    case "closing":
    case "closed":
      // Not a failure: `ws` reports these through the callback and leaves the socket
      // alone, because a send that arrived too late is not a fault of the socket.
      state.bufferedAmount += payload.bytes.length;
      defer(callback, notOpenError(state.readyState));
      return;
    case "invalid-handle":
    case "payload-too-large":
    case "protocol-error":
      reportFailure(state, callback, frameError(status));
      return;
  }
  // Every case returns, so this is the compile-time proof that a new status is
  // handled rather than ignored: adding a member to the union makes it a type error.
  throw unhandledFrameStatus(status);
}

function unhandledFrameStatus(status: never): Error {
  return createError(
    "ERR_INVALID_STATE",
    `ventijs: the codec reported an unknown frame status "${String(status)}"`,
  );
}
