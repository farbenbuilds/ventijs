import { WebSocket as WsClient, WebSocketServer as WsServer } from "ws";
import { expect } from "vitest";
import { attached, terminateClient } from "../compat/socket/socket-support";

/// A socket that exposes the operations this file compares.
///
/// The parameters are `unknown` because the point of these tests is the runtime
/// behaviour on arguments the published types already reject: a scenario has to
/// be able to pass whatever it is checking. `ws`'s narrower `close` satisfies
/// this only through the explicit cast at the call site below, which is confined
/// to the one place the two signatures differ.
export type Closable = {
  close: (code?: unknown, reason?: unknown) => void;
  ping: (data?: unknown) => void;
  pong: (data?: unknown) => void;
  readonly readyState: number;
};

/// What one operation produced, reduced to what the two implementations can be
/// compared on: whether it threw, with what class and text, and the state the
/// socket was left in.
///
/// `readyState` is on both variants and is compared on both. That is deliberate:
/// the latch is the behaviour most of these tests exist for, and an earlier
/// version carried the state only on the non-throwing side, so a refused `close`
/// compared the error and nothing else and passed with the latch reverted.
export type Outcome = {
  readonly threw: boolean;
  readonly readyState: number;
  readonly name: string;
  readonly message: string;
};

/// Stands up a `ws` server and hands back the accepted server-side socket, so a
/// scenario can be run against the reference implementation.
async function wsAccepted(): Promise<{
  readonly socket: WsClient;
  readonly dispose: () => Promise<void>;
}> {
  const server = new WsServer({ port: 0 });
  const accepted = new Promise<WsClient>((resolve) => {
    server.on("connection", (socket: WsClient) => {
      resolve(socket);
    });
  });
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const client = new WsClient(`ws://127.0.0.1:${port}/`);
  client.on("error", () => {});
  const socket = await accepted;
  return {
    socket,
    dispose: async () => {
      client.terminate();
      socket.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/// The single cast in this file, and it is needed on both sides: both vendored
/// `WebSocket` declarations type `close` as `(code?: number, reason?: string |
/// Buffer)`, and every scenario here deliberately passes values outside that,
/// because refusing them is the behaviour under test.
function asClosable(socket: object): Closable {
  return socket as Closable;
}

/// Runs one scenario against `ws` and then against ventijs and compares the two.
///
/// Neither fixture is shared, because a socket that has been closed cannot be
/// reused. `ws` runs first so a ventijs failure can never leave its server
/// listening, and the reference is the oracle: an equal outcome returns it, and a
/// divergence is the assertion that fails.
export async function parity(scenario: (socket: Closable) => void): Promise<Outcome> {
  const measure = (socket: Closable): Outcome => {
    try {
      scenario(socket);
      return {
        threw: false,
        readyState: socket.readyState,
        name: "",
        message: "",
      };
    } catch (error) {
      const failure = error as Error;
      return {
        threw: true,
        // Read after the throw: a refused `close` still has to have latched, and
        // that is the half of the behaviour an error comparison misses.
        readyState: socket.readyState,
        name: failure.constructor.name,
        message: failure.message,
      };
    }
  };
  const reference = await wsAccepted();
  let expected: Outcome;
  try {
    expected = measure(asClosable(reference.socket));
  } finally {
    await reference.dispose();
  }
  const ours = await attached();
  let actual: Outcome;
  try {
    actual = measure(asClosable(ours.socket));
  } finally {
    terminateClient(ours.client);
    await ours.server.dispose();
  }
  expect(actual.threw).toBe(expected.threw);
  if (expected.threw && !actual.threw) {
    throw new Error(`expected a throw like ws: ${expected.message}`);
  }
  expect(actual.name).toBe(expected.name);
  expect(actual.message).toBe(expected.message);
  expect(actual.readyState).toBe(expected.readyState);
  return actual;
}
