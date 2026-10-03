import type { EventMap, EventName, Listener, Registry } from "../../../src/types/events";
import { dispatchWith, unsubscribeMatching } from "../../../src/compat/events/registry";

/// The registry has one dispatch and one removal. Both are exported in the general
/// form the production callers need, because the vendored `@types/ws` listeners
/// declare `this` and both real removal sites match through a tag predicate. The
/// identity forms are spelled here rather than exported: an export no `src/`
/// module imports is a second way to do the same thing, and the second way is the
/// one that drifts.
export function dispatch<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
  ...args: E[K]
): number {
  return dispatchWith(registry, undefined, event, args);
}

export function unsubscribe<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
  handler: Listener<E, K>,
): Registry<E> {
  return unsubscribeMatching(registry, event, (entry) => entry === handler);
}
