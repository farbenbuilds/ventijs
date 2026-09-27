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
/// The ready state is part of the comparison rather than an afterthought,
/// because the latch is the behaviour under test: a refused `close` has to leave
/// the same state behind, and an error-only comparison cannot see that.
export type Outcome =
  | { readonly threw: false; readonly readyState: number }
  | { readonly threw: true; readonly name: string; readonly message: string };

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
      return { threw: false, readyState: socket.readyState };
    } catch (error) {
      const failure = error as Error;
      return { threw: true, name: failure.constructor.name, message: failure.message };
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
  if (!expected.threw) {
    expect(actual).toEqual(expected);
    return actual;
  }
  if (!actual.threw) throw new Error(`expected a throw like ws: ${expected.message}`);
  expect(actual.name).toBe(expected.name);
  expect(actual.message).toBe(expected.message);
  return actual;
}
