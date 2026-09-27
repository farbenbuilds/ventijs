import { pauseSocket, resumeSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import { CLOSED, CONNECTING } from "../ready-state";

/// Stops delivering messages to the application.
///
/// Both are no-ops while `CONNECTING` or `CLOSED`, matching `ws`, and both latch the
/// facade state so `isPaused` is readable immediately even before a native attachment
/// exists to act on it.
///
/// On a transport-owned socket the pause is the transport's, not a flag: pausing the
/// stream is what stops the kernel from filling a receive buffer with frames this
/// application has said it is not ready for, and a latched flag alone would let every
/// one of them arrive anyway.
export function pauseConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = true;
  if (state.attachment === null) {
    state.transport?.pause();
    return;
  }
  pauseSocket(state.attachment.server, state.attachment.connection);
}

/// Resumes delivery, the mirror of `pauseConnection`.
///
/// A resume for a transport-owned socket is deferred to a later tick when the socket is
/// still paused, because `resume()` from a `message` handler is the one place a caller
/// can call it synchronously while the codec is mid-dispatch; reading the latch again
/// is what stops a socket resumed and immediately re-paused from being woken anyway.
export function resumeConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = false;
  if (state.attachment === null) {
    state.transport?.resume();
    return;
  }
  resumeSocket(state.attachment.server, state.attachment.connection);
}
