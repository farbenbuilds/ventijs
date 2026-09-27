import type { ConnectionHandle } from "../../src/binding/handle";
import { packConnectionHandle } from "../../src/binding/handle";
import type { EngineEvent } from "../../src/binding/native";
import { pumpSocket, sendSocket, takeSocketMessage } from "../../src/binding/socket";
import { closeServer, createServer, finalizeServer, listenServer } from "../../src/binding/server";
import type { ServerHandle } from "../../src/binding/server";

const FINALIZE_ATTEMPTS = 200;
const POLL_INTERVAL_MS = 5;

export type Reply = {
  readonly bytes: Buffer;
  readonly isBinary: boolean;
};

export type EchoServer = {
  readonly handle: ServerHandle;
  readonly port: number;
  /// One entry per message the engine handed to JavaScript, in arrival order.
  readonly received: Reply[];
  /// Resolves on the first accepted connection. Await it after the peer
  /// connects: the server cannot observe a connection that has not happened.
  connection(): Promise<ConnectionHandle>;
  dispose(): Promise<void>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// A sticky one-shot read. The value is kept so a late subscriber still sees an
/// event that already fired, and the callback is kept so an early subscriber
/// still hears one that has not.
type Once<T> = {
  readonly value: T | null;
  readonly settled: Promise<T>;
  resolve(value: T): void;
};

function once<T>(): Once<T> {
  const state: { value: T | null; resolve: (value: T) => void } = {
    value: null,
    resolve: () => undefined,
  };
  const settled = new Promise<T>((resolve) => {
    state.resolve = resolve;
  });
  return {
    get value(): T | null {
      return state.value;
    },
    settled,
    resolve: (value: T): void => {
      state.value ??= value;
      state.resolve(state.value);
    },
  };
}

/// A reference echo over the engine, and the smallest application that exercises
/// the whole path: the engine parses a frame, hands the payload to JavaScript,
/// the application stages a reply, and the pump puts it on the wire.
///
/// `received` is recorded so a test can assert the inbound side without a second
/// listener racing the same ring for the payload.
export async function startEcho(): Promise<EchoServer> {
  const received: Reply[] = [];
  const listened = once<number>();
  const opened = once<ConnectionHandle>();
  // The dispatch only fires after `listenServer`, so the cell is populated
  // before the first event can arrive.
  let handle: ServerHandle = 0;

  const dispatch = (event: EngineEvent): void => {
    switch (event.kind) {
      case "listening":
        listened.resolve(event.code);
        return;
      case "connectionOpen":
        opened.resolve(packConnectionHandle(event.index, event.generation) as ConnectionHandle);
        return;
      case "connectionMessage":
        echo(handle, opened.value, received);
        return;
      default:
        return;
    }
  };

  handle = createServer({ host: "127.0.0.1", port: 0, path: "/" }, dispatch);
  listenServer(handle);
  return {
    handle,
    port: await listened.settled,
    received,
    connection: () => opened.settled,
    dispose: () => dispose(handle),
  };
}

/// Echoes one staged message back with the opcode the engine parsed, which is
/// what makes a text or binary mix-up visible on the far side of the test.
function echo(handle: ServerHandle, connection: ConnectionHandle | null, received: Reply[]): void {
  if (connection === null) return;
  const taken = takeSocketMessage(handle, connection);
  if (taken === null) return;
  received.push(taken);
  if (sendSocket(handle, connection, taken.bytes, taken.isBinary) !== "ok") return;
  pumpSocket(handle, connection);
}

async function dispose(handle: ServerHandle): Promise<void> {
  try {
    closeServer(handle);
  } catch {
    // Already closing or closed; the retry loop below settles it.
  }
  for (let attempt = 0; attempt < FINALIZE_ATTEMPTS; attempt += 1) {
    try {
      finalizeServer(handle);
      return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.message === "UnknownServer") return;
      if (error.message === "EventsPending" || error.message === "ServerNotClosed") {
        await delay(POLL_INTERVAL_MS);
        continue;
      }
      throw error;
    }
  }
  throw new Error("echo server did not drain before finalize");
}
