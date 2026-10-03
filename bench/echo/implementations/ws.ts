import { WebSocket as WsSocket, WebSocketServer as WsServer } from "ws";
import type { EchoClient, EchoConnection, EchoImplementation, EchoServer } from "../echo-types.ts";

const readPort = (address: { readonly port: number } | string | null): number => {
  if (address === null || typeof address === "string") {
    throw new Error("the server reported no TCP address");
  }
  return address.port;
};

const listenOn = (server: {
  once(event: "listening", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  address(): { readonly port: number } | string | null;
}): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => resolve(readPort(server.address())));
  });

const wsConnection = (socket: WsSocket): EchoConnection => ({
  send: (payload) => {
    socket.send(payload, { binary: true });
  },
  onMessage: (listener) => {
    socket.on("message", (data: Buffer) => listener(data));
  },
  onError: (listener) => {
    socket.on("error", listener);
  },
});

const wsServer = (server: WsServer): EchoServer => ({
  listen: () => listenOn(server),
  onConnection: (listener) => {
    server.on("connection", (socket: WsSocket) => listener(wsConnection(socket)));
  },
  onError: (listener) => {
    server.on("error", listener);
  },
  close: () => {
    server.close();
  },
});

export const wsEchoClient = (socket: WsSocket): EchoClient => ({
  send: (payload) => {
    socket.send(payload, { binary: true });
  },
  close: () => {
    socket.close();
  },
  onOpen: (listener) => {
    socket.on("open", listener);
  },
  onMessage: (listener) => {
    socket.on("message", (data: Buffer) => listener(data));
  },
  onError: (listener) => {
    socket.on("error", listener);
  },
});

/// `ws` is the gate baseline and the fixed client for every non-Socket.IO leg,
/// so its server stays stock: no `maxPayload` override, because its ability to
/// accept payloads above the ventiws ceiling is what the ceiling note discloses.
export const wsImplementation = (): EchoImplementation => ({
  id: "ws",
  createServer: (options) => wsServer(new WsServer(options)),
  connect: (url) => wsEchoClient(new WsSocket(url, { perMessageDeflate: false })),
});
