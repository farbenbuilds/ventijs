import { WebSocket as WsSocket, WebSocketServer as WsServer } from "ws";
import type {
  EchoClient,
  EchoConnection,
  EchoImplementation,
  EchoServer,
  EchoServerOptions,
  ImplementationId,
} from "./echo-types.ts";
import { nativeEchoServer } from "./native-server.ts";

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

const ventijsImplementation = (): EchoImplementation => ({
  id: "ventijs",
  label: "ventijs (native engine, ws client)",
  createServer: (options: EchoServerOptions): EchoServer => nativeEchoServer(options),
  // ventijs client construction throws ERR_INVALID_STATE, so the ws client
  // drives both legs. Holding the client fixed leaves the server as the only
  // variable between the two rows of the report.
  connect: (url: string): EchoClient => wsClient(new WsSocket(url, { perMessageDeflate: false })),
});

const wsClient = (socket: WsSocket): EchoClient => ({
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

const wsImplementation = (): EchoImplementation => ({
  id: "ws",
  label: "ws (server and client)",
  createServer: (options) => wsServer(new WsServer(options)),
  connect: (url) => wsClient(new WsSocket(url, { perMessageDeflate: false })),
});

export const resolveImplementation = (id: ImplementationId): EchoImplementation => {
  if (id === "ventijs") return ventijsImplementation();
  return wsImplementation();
};
