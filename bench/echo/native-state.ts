import type { EngineEvent, VentiAddon } from "../../src/binding/native.ts";
import type { EchoConnection } from "./echo-types.ts";

/// Mutable run state for one native echo server, and the transitions that turn
/// engine events into harness callbacks. Split out of `native-server.ts` so the
/// state shape and its event handling read without the server wiring.
export type EchoState = {
  server: number;
  connection: bigint | null;
  listeners: ((payload: Buffer) => void)[];
  errors: ((error: Error) => void)[];
  listening: number | null;
  accepted: boolean;
  onListening: ((port: number) => void) | null;
  onAccepted: ((connection: EchoConnection) => void) | null;
  onEngineError: ((error: Error) => void) | null;
};

export function initialState(): EchoState {
  return {
    server: 0,
    connection: null,
    listeners: [],
    errors: [],
    listening: null,
    accepted: false,
    onListening: null,
    onAccepted: null,
    onEngineError: null,
  };
}

export function onEngineEvent(a: VentiAddon, state: EchoState, event: EngineEvent): void {
  switch (event.kind) {
    case "listening":
      state.listening = event.code;
      state.onListening?.(event.code);
      return;
    case "connectionOpen":
      state.connection = pack(event.index, event.generation);
      state.accepted = true;
      // The harness subscribes before it connects, so the hand-off is
      // deferred until the engine has actually accepted a connection.
      state.onAccepted?.(nativeConnection(a, state));
      state.onAccepted = null;
      return;
    case "connectionMessage":
      deliver(a, state);
      return;
    case "engineError": {
      const error = new Error(`engine error ${event.code}`);
      state.onEngineError?.(error);
      for (const listener of state.errors) listener(error);
      return;
    }
    default:
      return;
  }
}

/// Hands every staged inbound message to the registered listeners.
///
/// The inbound ring is FIFO across the whole server, so this drains until it is
/// empty rather than taking one message per wakeup: a coalesced wakeup would
/// otherwise leave messages waiting for an event that never comes.
function deliver(a: VentiAddon, state: EchoState): void {
  const connection = state.connection;
  if (connection === null) return;
  for (;;) {
    const taken = a.takeSocketMessage(state.server, connection);
    if (taken === null) return;
    const bytes = taken[0];
    for (const listener of state.listeners) listener(bytes);
  }
}

export function nativeConnection(a: VentiAddon, state: EchoState): EchoConnection {
  return {
    send: (payload: Buffer) => {
      const connection = state.connection;
      if (connection === null) return;
      // The measured workload is binary, so the reply is staged as binary. A
      // send the engine refuses is not retried here; the next inbound message
      // pumps the ring again.
      if (a.sendSocket(state.server, connection, payload, true) !== 0) return;
      a.pumpSocket(state.server, connection);
    },
    onMessage: (listener) => {
      state.listeners.push(listener);
    },
    onError: (listener) => {
      state.errors.push(listener);
    },
  };
}

/// A connection handle is `generation << 32 | index`, the same packing
/// `src/binding/handle.ts` performs.
function pack(index: number, generation: number): bigint {
  return (BigInt(generation) << 32n) | BigInt(index);
}
