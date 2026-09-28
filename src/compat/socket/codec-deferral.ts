import type { SocketState } from "../../types/socket";

/// `allowSynchronousEvents: false`. A *pause*, not a buffer: `ws` stops its parse loop
/// in `DEFER_EVENT`, so the frames behind the first message are not read until the
/// application has heard about it. Buffering would deliver the same `message` events in
/// the same order and still differ, because a `close` frame in the same read would go out
/// ahead of the messages that preceded it on the wire.

export function isDeliveryPaused(state: SocketState): boolean {
  return state.deliveryPaused;
}

/// The resume is what drains the rest, so the caller stops as soon as this returns. One
/// resume per pause, not per event, so ten messages cost one tick. `setImmediate`, not
/// `queueMicrotask`: a microtask runs before the transport's next read in the same turn,
/// which is the thing the option exists to prevent.
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
