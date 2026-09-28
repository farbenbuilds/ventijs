import type { EmitterState, EventMap, EventName, Handler, Listener } from "../../types/events";
import { subscribe, unsubscribeMatching } from "./registry";

const MAX_WRAPPER_DEPTH = 3;

/// The emitter layer must never treat a wrapper as a user handler: `ws` keeps
/// `removeListener`/`listeners` disjoint from the `addEventListener` surface.
export const DOM_WRAPPER = Symbol("ventijs.domWrapper");

/// A function carrying the original handler on `listener`, which is Node's introspection
/// contract. DOM wrappers add the `DOM_WRAPPER` brand and an `attribute` flag.
export type TaggedHandler = Handler<readonly unknown[]> & {
  listener?: unknown;
  attribute?: boolean;
  [DOM_WRAPPER]?: true;
};

export function asTagged(entry: unknown): TaggedHandler {
  return entry as TaggedHandler;
}

/// The walk is bounded: only this module ever sets `listener`, and a user function cannot
/// extend the chain.
export function originalOf(entry: unknown): unknown {
  let current: unknown = entry;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (typeof current !== "function") return current;
    const next = asTagged(current).listener;
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

/// True when the entry is a DOM wrapper or a `once` wrapper around one.
export function isDomEntry(entry: unknown): boolean {
  const tagged = asTagged(entry);
  if (tagged[DOM_WRAPPER] === true) return true;
  const inner = tagged.listener;
  if (inner === undefined) return false;
  return asTagged(inner)[DOM_WRAPPER] === true;
}

/// The view `listeners()` exposes: `ws` returns its internal DOM wrapper for
/// `addEventListener` registrations and the original handler for `once`.
export function listenerView(entry: unknown): unknown {
  const tagged = asTagged(entry);
  const inner = tagged.listener;
  if (inner === undefined) return entry;
  if (isDomEntry(entry)) return asTagged(inner)[DOM_WRAPPER] === true ? inner : entry;
  return inner;
}

/// Removes the most recent entry that matches the handler directly or through
/// its wrapper tags, so `off(event, onceHandler)` works like Node. DOM
/// wrappers are skipped: only `removeEventListener` removes them.
export function removeTagged<E extends EventMap>(
  state: EmitterState<E>,
  event: EventName<E>,
  handler: unknown,
): void {
  state.listeners = unsubscribeMatching(
    state.listeners,
    event,
    (entry) => entry === handler || (!isDomEntry(entry) && originalOf(entry) === handler),
  );
}

/// Self-removing one-shot wrapper shared by `once`, `prependOnceListener`,
/// and the DOM `once` option. It unsubscribes before invoking so a throwing
/// handler cannot run twice.
export function onceWrapper<E extends EventMap, K extends EventName<E>>(
  state: EmitterState<E>,
  event: K,
  raw: Listener<E, K>,
): TaggedHandler {
  const wrapper = (...args: E[K]): void => {
    state.listeners = unsubscribeMatching(
      state.listeners,
      event,
      (entry) => entry === (wrapper as unknown as Listener<E, K>),
    );
    Reflect.apply(raw, state.target, args);
  };
  return Object.assign(wrapper, { listener: raw }) as unknown as TaggedHandler;
}

export function onceEvent<E extends EventMap, K extends EventName<E>>(
  state: EmitterState<E>,
  event: K,
  handler: Listener<E, K>,
): void {
  state.listeners = subscribe(state.listeners, event, onceWrapper(state, event, handler));
}
