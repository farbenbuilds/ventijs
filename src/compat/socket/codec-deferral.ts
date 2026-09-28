import type { SocketState } from "../../types/socket";

/// `allowSynchronousEvents: false`. A *pause*, not a buffer: `ws` stops its parse loop in
/// `DEFER_EVENT`, and buffering would still emit a `close` frame ahead of the messages before it.

export function isDeliveryPaused(state: SocketState): boolean {
  return state.deliveryPaused;
}

/// The resume is what drains the rest, so the caller stops as soon as this returns. One resume
/// per pause, not per event, so ten messages cost one tick; `setImmediate`, not a microtask.
export function pauseUntilNextTick(state: SocketState, resume: () => void): boolean {
  if (state.deliveryPaused) return true;
  state.deliveryPaused = true;
  const unref = setImmediate(() => {
    state.deliveryPaused = false;
    resume();
  });
  // A socket library has no business being the reason a process stays up.
  unref.unref?.();
  return true;
}
