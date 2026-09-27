import type { EngineEvent, EngineEventKind, NativeServerConfig } from "../../src/binding/native";
import { closeServer, createServer, finalizeServer, listenServer } from "../../src/binding/server";

export const EVENT_TIMEOUT_MS = 8_000;
export const TEST_TIMEOUT_MS = 20_000;

const FINALIZE_ATTEMPTS = 200;
const POLL_INTERVAL_MS = 5;

export type ServerFixture = {
  readonly handle: number;
  readonly events: EngineEvent[];
  waitFor(kind: EngineEventKind): Promise<EngineEvent>;
  waitForCount(kind: EngineEventKind, count: number): Promise<void>;
  settle(): Promise<void>;
  dispose(): Promise<void>;
};

function engineFailure(events: EngineEvent[]): Error | undefined {
  const event = events.find((candidate) => candidate.kind === "engineError");
  if (event === undefined) return undefined;
  return new Error(`engineError received (code ${event.code})`);
}

const countOf = (events: EngineEvent[], kind: EngineEventKind): number =>
  events.filter((event) => event.kind === kind).length;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function waitUntil(
  events: EngineEvent[],
  ready: (events: EngineEvent[]) => boolean,
  describe: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + EVENT_TIMEOUT_MS;
    function poll(): void {
      const failure = engineFailure(events);
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      if (ready(events)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${describe}`));
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();
  });
}

/// Resolves once the event list has not grown for three consecutive polls, so
/// a late duplicate terminal event cannot pass an exactly-once assertion.
function settleEvents(events: EngineEvent[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let lastLength = events.length;
    let stable = 0;
    const deadline = Date.now() + EVENT_TIMEOUT_MS;
    function poll(): void {
      const failure = engineFailure(events);
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      if (events.length === lastLength) {
        stable += 1;
      } else {
        stable = 0;
        lastLength = events.length;
      }
      if (stable >= 3) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("timed out waiting for the event stream to settle"));
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();
  });
}

export function fixture(config: NativeServerConfig): ServerFixture {
  const events: EngineEvent[] = [];
  const handle = createServer(config, (event) => {
    events.push(event);
  });

  return {
    handle,
    events,
    waitFor: (kind) =>
      waitUntil(events, (seen) => countOf(seen, kind) > 0, kind).then(() => {
        const found = events.find((event) => event.kind === kind);
        if (found === undefined) throw new Error(`missing ${kind} after wait`);
        return found;
      }),
    waitForCount: (kind, count) =>
      waitUntil(events, (seen) => countOf(seen, kind) >= count, `${count} x ${kind}`),
    settle: () => settleEvents(events),
    async dispose() {
      try {
        closeServer(handle);
      } catch {
        // Already closing, closed, or finalized; the loop below settles it.
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
      // Raised, not returned: returning here leaves the slot owned, the next
      // `fixture()` takes it, and a test holding the old handle resolves a live
      // server instead of the `UnknownServer` it asserts.
      throw new Error(`server ${handle} did not drain; its slot is still owned`);
    },
  };
}

export function start(config: NativeServerConfig): ServerFixture {
  const server = fixture(config);
  listenServer(server.handle);
  return server;
}

/// Starts a server and resolves its bound port from the `listening` event, so
/// `port: 0` tests never race another process for a probed port.
export async function startAndWait(
  config: NativeServerConfig,
): Promise<{ readonly server: ServerFixture; readonly port: number }> {
  const server = start(config);
  const listening = await server.waitFor("listening");
  return { server, port: listening.code };
}
