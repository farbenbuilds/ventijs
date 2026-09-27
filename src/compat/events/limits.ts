import type { EmitterState, EventMap, EventName } from "../../types/events";
import { createError } from "../errors";
import { listenerCount } from "./registry";

/// Raises Node's listener-leak warning when a registration passes the limit.
///
/// This is the one diagnostic that turns a listener leak into something visible,
/// and it was inert: `maxListeners` was stored, validated, and reported by
/// `getMaxListeners`, but nothing ever compared it to a count. A facade leaking a
/// listener per connection was therefore completely silent, where both `ws` and
/// Node warn.
///
/// The guard is `limit > 0`, so `setMaxListeners(0)` means unlimited exactly as
/// it does in Node. The warning is raised once per event through `state.warned`,
/// not once per registration, because a repeated warning for a single leak
/// trains callers to ignore it.
export function warnOnOverflow<E extends EventMap>(
  state: EmitterState<E>,
  event: EventName<E>,
): void {
  if (state.maxListeners <= 0) return;
  const count = listenerCount(state.listeners, event);
  if (count <= state.maxListeners) return;
  const name = String(event);
  if (state.warned.has(name)) return;
  state.warned.add(name);
  process.emitWarning(createOverflowWarning(count, name, state.maxListeners));
}

/// Drops the leak flag so a listener removed and re-added past the limit warns
/// again. Node resets the flag in `removeAllListeners` and in `setMaxListeners`,
/// and so does this.
export function forgetWarning<E extends EventMap>(
  state: EmitterState<E>,
  event: EventName<E> | undefined,
): void {
  if (event === undefined) {
    state.warned.clear();
    return;
  }
  state.warned.delete(String(event));
}

function createOverflowWarning(count: number, event: string, limit: number): Error {
  const warning = new Error(
    `Possible EventEmitter memory leak detected. ${count} ${event} listeners added to ` +
      `the emitter. MaxListeners is ${limit}. Use emitter.setMaxListeners() to increase limit`,
  );
  warning.name = "MaxListenersExceededWarning";
  return warning;
}

/// Keeps Node's `validateNumber(n, 'n', 0)` contract, because `ws` delegates to
/// `EventEmitter` and a caller that relies on the rejection sees a `TypeError`
/// upstream and a silent `Infinity` here.
///
/// A fractional value is accepted, as Node accepts it: only a non-number and a
/// negative or `NaN` count are refused.
export function assertListenerLimit(count: number): number {
  if (typeof count !== "number") {
    throw createError(
      "ERR_INVALID_OPTION",
      'The "setMaxListeners" argument must be of type number. Received ' + String(count),
      TypeError,
    );
  }
  if (count < 0 || Number.isNaN(count)) {
    throw createError(
      "ERR_INVALID_OPTION",
      `The value of "setMaxListeners" is out of range. It must be >= 0. Received ${count}`,
      RangeError,
    );
  }
  return count;
}
