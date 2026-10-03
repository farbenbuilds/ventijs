import { createRequire } from "node:module";
import { WebSocket as WsSocket } from "ws";
import type {
  EchoClient,
  EchoConnection,
  EchoImplementation,
  EchoServer,
  EchoServerOptions,
} from "../echo-types.ts";
import { wsEchoClient } from "./ws.ts";

/// The facade is the product: the public `WebSocketServer` frames with the Zig codec over
/// the Node transport (`CODEBASE.md`), so this is the candidate the gate reads. The bundle
/// is loaded through `require` rather than a typed import because `pnpm typecheck` runs
/// without a build and the declaration file lives in the gitignored `dist/`.
type FacadeSocket = {
  send(data: Buffer, options: { binary: boolean }): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type FacadeServer = {
  on(event: "connection", listener: (socket: FacadeSocket) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "listening", listener: () => void): void;
  address(): { readonly port: number } | string | null;
  close(): void;
};

type FacadeModule = {
  WebSocketServer: new (options: {
    host: string;
    port: number;
    perMessageDeflate: boolean;
  }) => FacadeServer;
};

const require = createRequire(import.meta.url);

const loadFacade = (): FacadeModule => require("../../../dist/index.cjs") as FacadeModule;

const readPort = (address: { readonly port: number } | string | null): number => {
  if (address === null || typeof address === "string") {
    throw new Error("the facade reported no TCP address");
  }
  return address.port;
};

const facadeConnection = (socket: FacadeSocket): EchoConnection => ({
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

const facadeServer = (options: EchoServerOptions): EchoServer => {
  const server = new (loadFacade().WebSocketServer)({
    host: options.host,
    port: options.port,
    perMessageDeflate: options.perMessageDeflate,
  });
  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.once("listening", () => resolve(readPort(server.address())));
      }),
    onConnection: (listener) => {
      server.on("connection", (socket) => listener(facadeConnection(socket)));
    },
    onError: (listener) => {
      server.on("error", listener);
    },
    close: () => {
      server.close();
    },
  };
};

export const ventiwsImplementation = (): EchoImplementation => ({
  id: "ventiws",
  createServer: (options: EchoServerOptions) => facadeServer(options),
  // The facade client exists, but the bench holds the client fixed for every non-Socket.IO
  // leg, so the server stays the only variable against the ws row.
  connect: (url: string): EchoClient =>
    wsEchoClient(new WsSocket(url, { perMessageDeflate: false })),
});
