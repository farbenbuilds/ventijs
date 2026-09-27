import { WebSocket as WsClient, WebSocketServer as WsServer } from "ws";
import { expect, test } from "vitest";
import { WebSocketServer } from "../../src/index";
import type { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { terminateClient } from "../compat/socket/socket-support";

/// A socket whose open and close can be driven, as both implementations expose it.
type Closable = {
  on: (event: string, handler: (error: Error) => void) => void;
  close: (code?: number) => void;
  send: (data: string) => void;
  readonly readyState: number;
  readonly CLOSING: number;
};

/// What one socket looked like after sending on a socket that was not open.
type Observed = { readonly errors: number; readonly closing: boolean };

async function observe(socket: Closable): Promise<Observed> {
  const errors: Error[] = [];
  socket.on("error", (error) => errors.push(error));
  socket.close(1000);
  socket.send("hello");
  await new Promise((resolve) => setImmediate(resolve));
  return { errors: errors.length, closing: socket.readyState === socket.CLOSING };
}

function portOf(server: { address: () => unknown }): number {
  return (server.address() as { port: number }).port;
}

/// A send on a socket that is not open is `sendAfterClose`, and it changes
/// nothing: no `error` event, and the close already in progress continues. An
/// earlier version routed it through the error path, which closed the socket
/// outright and emitted, and a caller sending during a close in progress cannot
/// tell that apart from a real fault.
test("a send after close matches ws", { timeout: TEST_TIMEOUT_MS }, async () => {
  const reference = new WsServer({ port: 0 });
  const taken = new Promise<WsClient>((resolve) => {
    reference.on("connection", (socket: WsClient) => resolve(socket));
  });
  const client = new WsClient(`ws://127.0.0.1:${portOf(reference)}/`);
  client.on("error", () => {});
  await new Promise<void>((resolve) => {
    reference.once("listening", resolve);
  });
  const expected = await observe(await taken);
  client.terminate();
  await new Promise<void>((resolve) => {
    reference.close(() => resolve());
  });
  expect(expected).toEqual({ errors: 0, closing: true });

  const ours = new WebSocketServer({ port: 0 });
  const accepted = new Promise<WebSocket>((resolve) => {
    ours.on("connection", (socket) => resolve(socket));
  });
  const ourClient = new WsClient(`ws://127.0.0.1:${portOf(ours)}/`);
  ourClient.on("error", () => {});
  await new Promise<void>((resolve) => {
    ours.once("listening", resolve);
  });
  try {
    expect(await observe(await accepted)).toEqual(expected);
  } finally {
    terminateClient(ourClient);
    await new Promise<void>((resolve) => {
      ours.close(() => resolve());
    });
  }
});
