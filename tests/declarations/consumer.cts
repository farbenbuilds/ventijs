// The package as a CommonJS TypeScript consumer sees it.
//
// This file is the reason `exports` has a `require` condition and a `types` condition
// under it. A package that is ESM-only does not fail a CommonJS consumer at runtime on
// a modern Node -- `require` of an ES module works from Node 22.12 -- it fails at
// *compile* time, with TS1479 and TS1541, before a line of the consumer runs:
//
//   app.ts(1,67): error TS1479: The current file is a CommonJS module whose imports
//     will produce 'require' calls; however, the referenced file is an ECMAScript
//     module and cannot be imported with 'require'.
//
// Nothing a caller does in their own `tsconfig` fixes that, and the identical file
// compiles clean against `ws`. The same `moduleResolution: node16` is used here, with
// `skipLibCheck: false`, so the declarations are checked rather than trusted.
//
// The import is a named one rather than `import WebSocket = require(...)`. `ws` is
// `export =` a class, so that form gives the class; ventijs is a namespace with the
// class in it, so the form is `require("ventijs").WebSocket` at runtime and a named
// import in TypeScript. Both are the same object, and the difference is recorded in
// `docs/migrating.md` rather than papered over with a declaration that would not
// match the runtime.

import type {
  ClientOptions,
  RawData,
  Server,
  ServerOptions,
  WebSocket,
  WebSocketServer,
  createWebSocketStream,
} from "ventijs";

type WebSocketConstructor = typeof WebSocket;

export type Socket = InstanceType<WebSocketConstructor>;
export type Options = ServerOptions;
export type Client = ClientOptions;
export type Data = RawData;
export type CreateStream = typeof createWebSocketStream;
export type ServerType = Server;
export type Constructed = WebSocketServer;
