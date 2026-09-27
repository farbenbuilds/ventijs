import { pauseSocket, resumeSocket } from "../../binding/socket";
import type { SocketState } from "../../types/socket";
import { CLOSED, CONNECTING } from "../ready-state";

/// Backpressure gating. Both are no-ops while `CONNECTING` or `CLOSED`, matching
/// `ws`, and both latch the facade state so `isPaused` is readable immediately
/// even before a native attachment exists to act on it.
export function pauseConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = true;
  if (state.attachment === null) return;
  pauseSocket(state.attachment.server, state.attachment.connection);
}

export function resumeConnection(state: SocketState): void {
  if (state.readyState === CONNECTING || state.readyState === CLOSED) return;
  state.isPaused = false;
  if (state.attachment === null) return;
  resumeSocket(state.attachment.server, state.attachment.connection);
}
