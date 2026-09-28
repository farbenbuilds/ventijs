export type EventMap = {
  readonly [event: string]: readonly unknown[];
};

export type EventName<E extends EventMap> = keyof E;

export type Handler<Args extends readonly unknown[]> = (...args: Args) => void;

export type Listener<E extends EventMap, K extends EventName<E>> = Handler<E[K]>;

export type Registry<E extends EventMap> = {
  [K in EventName<E>]?: readonly Listener<E, K>[];
};

/// The mutable slice an emitter factory closes over. `target` is the record
/// listeners observe as `this`; it is assigned once the record exists.
export type EmitterState<E extends EventMap> = {
  listeners: Registry<E>;
  maxListeners: number;
  /// Events already reported past `maxListeners`. Node warns once per event rather than
  /// once per registration, and a repeated warning for a single leak trains callers to
  /// ignore it.
  warned: Set<string>;
  target: unknown;
};

export type Registration<E extends EventMap> = <K extends EventName<E>>(
  event: K,
  handler: Listener<E, K>,
) => void;

export type Lookup<E extends EventMap> = <K extends EventName<E>>(event: K) => Listener<E, K>[];

/// `ws` types the registration methods as returning the emitter; the constructor boundary
/// restores that with a cast, so the factories never touch `this`.
export type Emitter<E extends EventMap> = {
  on: Registration<E>;
  addListener: Registration<E>;
  once: Registration<E>;
  prependListener: Registration<E>;
  prependOnceListener: Registration<E>;
  off: Registration<E>;
  removeListener: Registration<E>;
  removeAllListeners: (event?: EventName<E>) => void;
  emit: <K extends EventName<E>>(event: K, ...args: E[K]) => boolean;
  listeners: Lookup<E>;
  rawListeners: Lookup<E>;
  eventNames: () => EventName<E>[];
  listenerCount: (event: EventName<E>) => number;
  getMaxListeners: () => number;
  setMaxListeners: (count: number) => void;
};
