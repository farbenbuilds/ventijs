// The package as a CommonJS TypeScript consumer sees it, and the reason `exports` has a
// `require` condition with `types` under it: an ESM-only package fails at *compile* time
// with TS1479 and TS1541, before a line of the consumer runs, and nothing in the caller's
// tsconfig fixes it while the identical file compiles clean against `ws`. Checked with
// `moduleResolution: node16` and `skipLibCheck: false`. The import is a named one because
// `ws` is `export =` a class and ventiws is a namespace with the class inside it.

import type {
  ClientOptions,
  RawData,
  Server,
  ServerOptions,
  WebSocket,
  WebSocketServer,
  createWebSocketStream,
} from "ventiws";

type WebSocketConstructor = typeof WebSocket;

export type Socket = InstanceType<WebSocketConstructor>;
export type Options = ServerOptions;
export type Client = ClientOptions;
export type Data = RawData;
export type CreateStream = typeof createWebSocketStream;
export type ServerType = Server;
export type Constructed = WebSocketServer;
