import type { SocketState } from "../../types/socket";

/// `allowSynchronousEvents: false`. A *pause*, not a buffer: `ws` stops its parse loop in
/// `DEFER_EVENT`, and buffering would still emit a `close` frame ahead of the messages before it.
export function isDeliveryPaused(state: SocketState): boolean {
  return state.deliveryPaused;
}

/// The resume drains the rest, so the caller stops as soon as this returns. One resume per pause
/// rather than per event, so ten messages cost one tick. `setImmediate`, not a microtask.
export function pauseUntilNextTick(state: SocketState, resume: () => void): boolean {
  if (state.deliveryPaused) return true;
  state.deliveryPaused = true;
  // Not unref'd, unlike a keepalive timer: an unref'd immediate starves the queue rather than
  // delaying it, because the loop sleeps in poll until something else wakes it.
  setImmediate(() => {
    state.deliveryPaused = false;
    resume();
  });
  return true;
}
