import { pauseSocket, resumeSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import { CLOSED, CONNECTING } from "../ready-state";

/// No-ops while `CONNECTING` or `CLOSED`, matching `ws`, and latches the facade state so
/// `isPaused` is readable before a native attachment exists to act on it.

// On a transport-owned socket the pause is the transport's, not a flag: pausing the
// stream is what stops the kernel filling a receive buffer with frames this application
// has said it is not ready for.
export function pauseConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = true;
  if (state.attachment === null) {
    state.transport?.pause();
    return;
  }
  pauseSocket(state.attachment.server, state.attachment.connection);
}

/// The mirror of `pauseConnection`. A resume while the socket is still paused is deferred
/// to a later tick: `resume()` from a `message` handler is the one place a caller can
/// call it synchronously mid-dispatch, and re-reading the latch stops a socket resumed
/// and immediately re-paused from being woken anyway.
export function resumeConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = false;
  if (state.attachment === null) {
    state.transport?.resume();
    return;
  }
  resumeSocket(state.attachment.server, state.attachment.connection);
}
