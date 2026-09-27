import { WebSocket as WsClient, WebSocketServer as WsServer } from "ws";
import { packConnectionHandle } from "../../src/binding/handle";
import { attachNativeSocket } from "../../src/compat/socket/attach";
import { WebSocket } from "../../src/index";
import { startAndWait } from "../binding/support";
import type { ServerFixture } from "../binding/support";
import { terminateClient } from "../compat/socket/socket-support";

export type Closable = {
  close: (code?: unknown, reason?: unknown) => void;
  ping: (data?: unknown) => void;
  pong: (data?: unknown) => void;
  readonly readyState: number;
};

export function asClosable(socket: object): Closable {
  return socket as Closable;
}

export type Outcome = {
  readonly threw: boolean;
  readonly readyState: number;
  readonly name: string;
  readonly message: string;
};

export type Compared = { readonly expected: Outcome; readonly actual: Outcome };

/// One accepted connection, on either implementation.
export type Fixture = {
  readonly socket: Closable;
  readonly client: WsClient;
  readonly server: ServerFixture | null;
  readonly dispose: () => Promise<void>;
};

/// Stands up a `ws` server and hands back the accepted server-side socket, which
/// is the reference every comparison runs against first.
export async function wsAccepted(): Promise<Fixture> {
  const server = new WsServer({ port: 0 });
  const accepted = new Promise<WsClient>((resolve) => {
    server.on("connection", (socket: WsClient) => resolve(socket));
  });
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const client = new WsClient(`ws://127.0.0.1:${port}/`);
  client.on("error", () => {});
  const socket = await accepted;
  return {
    socket: asClosable(socket),
    client,
    server: null,
    dispose: async () => {
      client.terminate();
      socket.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/// Starts a native server, connects a `ws` client, and adopts the accepted
/// connection into a compat socket, so the same scenario can run on ventijs.
export async function adopted(): Promise<Fixture> {
  const { server, port } = await startAndWait({ host: "127.0.0.1", port: 0 });
  const client = new WsClient(`ws://127.0.0.1:${port}/`);
  try {
    const open = await server.waitFor("connectionOpen");
    const socket = new WebSocket(null);
    attachNativeSocket(socket, server.handle, packConnectionHandle(open.index, open.generation));
    return {
      socket: asClosable(socket),
      client,
      server,
      dispose: async () => {
        terminateClient(client);
        await server.dispose();
      },
    };
  } catch (error) {
    terminateClient(client);
    await server.dispose();
    throw error;
  }
}
