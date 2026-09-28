import type { SocketState } from "../../types/socket";

/// `allowSynchronousEvents: false`, which is the only reason anything is in here.
///
/// `ws` defers `message`, `ping`, and `pong` to a later tick so a peer that fills one
/// read with ten messages cannot run ten handlers inside the transport's callback. The
/// option was normalized, documented, typed, and never read, so a caller who set
/// `false` for WHATWG-shaped event-loop behaviour watched every event arrive
/// synchronously and had no way to tell the difference.
///
/// It is a *pause*, not a buffer, and that is the load-bearing detail. `ws` stops its
/// parse loop in `DEFER_EVENT` and resumes it from the deferred callback, so the
/// frames behind the first message are not read until the application has heard about
/// it. Collecting the payloads and dispatching them all on the next tick would
/// deliver the same `message` events in the same order and still differ: a `close`
/// frame in the same read would be dispatched immediately, ahead of the messages that
/// preceded it on the wire.
///
/// Its own module because the policy is one bit of state and a timer, and neither
/// belongs in the dispatcher: the dispatcher answers "what does one decoded event
/// mean" and this answers "when does the application get to hear about it".

/// Whether this socket's delivery is paused waiting for a tick.
export function isDeliveryPaused(state: SocketState): boolean {
  return state.deliveryPaused;
}

/// Pauses delivery for one tick and schedules the resume, returning true.
///
/// The resume is what drains the rest, so the caller stops as soon as this returns.
/// It is scheduled once per pause rather than once per event, which is what makes a
/// read of ten messages cost one tick instead of ten.
///
/// `setImmediate` and not `queueMicrotask`: a microtask runs before the transport's
/// next read in the same turn of the loop, so the application would still be running
/// handlers inside the read that produced them, which is the option's whole point.
export function pauseUntilNextTick(state: SocketState, resume: () => void): boolean {
  if (state.deliveryPaused) return true;
  state.deliveryPaused = true;
  const unref = setImmediate(() => {
    state.deliveryPaused = false;
    resume();
  });
  // A pending resume must not be the reason a process stays up, for the same reason the
  // close deadline is not: a socket library has no business holding a loop open.
  unref.unref?.();
  return true;
}
