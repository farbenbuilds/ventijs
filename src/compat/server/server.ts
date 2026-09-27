import { STATUS_CODES, createServer as createHttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerEventMap, ServerSocketConstructor, ServerState } from "../../types/server";
import type { ServerOptions, WebSocket, WebSocketServer } from "../../types/ws";
import { createEmitter } from "../events/emitter";
import { createRegistry } from "../events/registry";
import { addressOf, closeWebSocketServer } from "./close";
import { wireServer } from "./listeners";
import { normalizeServerOptions } from "../options/server";
import { defaultShouldHandle, handleUpgrade } from "./upgrade";
import type { UpgradeCallback } from "./accept";

const SERVER_BRAND = Symbol("ventijs.server");

type BrandedServer = { readonly [SERVER_BRAND]?: true };

export function isServer(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as BrandedServer)[SERVER_BRAND] === true;
}

/// Builds the `ws`-shaped server record. The listener modes match upstream:
/// an explicit `port` owns an internal HTTP server answering 426 to plain
/// requests, `server` adopts the caller's HTTP server, and `noServer` only
/// accepts sockets passed to `handleUpgrade`.
export function createWebSocketServer(
  socketClass: ServerSocketConstructor,
  options?: ServerOptions,
  callback?: () => void,
): WebSocketServer {
  const resolved = {
    allowSynchronousEvents: true,
    autoPong: true,
    // `ws` defaults the three sender limits that `@types/ws` declares but its
    // reference does not list, and they are observable on `server.options`.
    maxBufferedChunks: 262144,
    maxFragments: 16384,
    closeTimeout: 30000,
    maxPayload: 100 * 1024 * 1024,
    skipUTF8Validation: false,
    perMessageDeflate: false,
    handleProtocols: null,
    clientTracking: true,
    verifyClient: null,
    noServer: false,
    backlog: null,
    server: null,
    host: null,
    path: null,
    port: null,
    WebSocket: socketClass,
    ...options,
  } as ServerOptions;
  // `ws` rewrites the shorthand `perMessageDeflate: true` to an options object
  // on the public record, so `server.options.perMessageDeflate` is an object for
  // a caller that enabled the extension and a boolean for one that did not.
  if (resolved.perMessageDeflate === true) resolved.perMessageDeflate = {};
  const normalized = normalizeServerOptions(resolved);
  const state: ServerState = {
    options: resolved,
    normalizedOptions: normalized,
    path: resolved.path ?? "",
    clients: resolved.clientTracking === false ? undefined : new Set<WebSocket>(),
    webSocket: (resolved.WebSocket ?? socketClass) as ServerSocketConstructor,
    server: null,
    lifecycle: "running",
    record: null,
    shouldEmitClose: false,
    removeListeners: null,
    listeners: createRegistry<ServerEventMap>(),
    maxListeners: 10,
    target: undefined,
  };

  if (resolved.port !== null && resolved.port !== undefined) {
    const httpServer = createHttpServer((_request, response) => {
      const body = STATUS_CODES[426] ?? "Upgrade Required";
      response.writeHead(426, {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "text/plain",
      });
      response.end(body);
    });
    state.server = httpServer as ServerState["server"];
    httpServer.listen(
      resolved.port,
      resolved.host ?? undefined,
      resolved.backlog ?? undefined,
      callback,
    );
  } else if (resolved.server) {
    state.server = resolved.server;
  }
  if (state.server !== null) wireServer(state);

  const server = {
    ...createEmitter(state),
    options: resolved,
    path: state.path,
    // `ws` assigns `clients` only when `clientTracking` is truthy, so the key is
    // absent rather than present-and-undefined. A caller that tests
    // `"clients" in server`, enumerates `Object.keys`, or spreads the record sees
    // the difference, and an empty set behaves differently again: `ws` reports
    // `undefined` where an empty set would give a size of 0.
    ...(state.clients === undefined ? {} : { clients: state.clients }),
    address: () => addressOf(state),
    close: (closeCallback?: (error?: Error) => void): void => {
      closeWebSocketServer(state, closeCallback);
    },
    handleUpgrade: (
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      upgradeCallback: UpgradeCallback,
    ): void => {
      handleUpgrade(state, request, socket, head, upgradeCallback);
    },
    shouldHandle: (request: IncomingMessage): boolean => defaultShouldHandle(state, request),
  };
  state.target = server;
  // Resolved at call time, so a later `server.shouldHandle = ...` is the
  // predicate the upgrade path consults, which is `ws`'s `this.shouldHandle(req)`.
  state.record = server;
  Object.defineProperty(server, SERVER_BRAND, { value: true });
  return server as unknown as WebSocketServer;
}
