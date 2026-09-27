import type { EventMap, EventName, Listener, Registry } from "../../types/events";

export function createRegistry<E extends EventMap>(): Registry<E> {
  return {};
}

export function listenerCount<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
): number {
  return registry[event]?.length ?? 0;
}

export function subscribe<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
  handler: Listener<E, K>,
): Registry<E> {
  const bucket = registry[event] ?? [];
  return { ...registry, [event]: [...bucket, handler] };
}

export function prepend<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
  handler: Listener<E, K>,
): Registry<E> {
  const bucket = registry[event] ?? [];
  return { ...registry, [event]: [handler, ...bucket] };
}

/// Removes the most recent entry a predicate accepts, matching
/// `EventEmitter.removeListener`, which scans from the end. Once wrappers and
/// DOM listeners are matched through their tags by the caller.
export function unsubscribeMatching<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  event: K,
  matches: (handler: Listener<E, K>) => boolean,
): Registry<E> {
  const bucket = registry[event];
  if (bucket === undefined) return registry;
  let index = bucket.length - 1;
  while (index >= 0) {
    if (matches(bucket[index])) {
      return { ...registry, [event]: bucket.toSpliced(index, 1) };
    }
    index -= 1;
  }
  return registry;
}

export function removeAll<E extends EventMap>(
  registry: Registry<E>,
  event?: EventName<E>,
): Registry<E> {
  if (event === undefined) return {};
  return { ...registry, [event]: [] };
}

export function eventNames<E extends EventMap>(registry: Registry<E>): EventName<E>[] {
  const names: EventName<E>[] = [];
  for (const key of Object.keys(registry) as EventName<E>[]) {
    if ((registry[key]?.length ?? 0) > 0) names.push(key);
  }
  return names;
}

/// Dispatches with the emitter as `this`, which is the contract the vendored
/// `@types/ws` listeners declare. `Reflect.apply` accepts the readonly tuple
/// the event map carries.
export function dispatchWith<E extends EventMap, K extends EventName<E>>(
  registry: Registry<E>,
  target: unknown,
  event: K,
  ...args: E[K]
): number {
  const bucket = registry[event];
  if (bucket === undefined) return 0;
  for (let index = 0; index < bucket.length; index += 1) {
    Reflect.apply(bucket[index], target, args);
  }
  return bucket.length;
}
