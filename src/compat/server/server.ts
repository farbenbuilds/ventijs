import { STATUS_CODES, createServer as createHttpServer } from "node:http";
import { loadAddon } from "../../binding/load";
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

/// Loads the native addon, or throws with something the caller can act on.
///
/// A missing artifact thrown from a Node `upgrade` listener is an uncaught exception
/// that takes the process down, with a message about `pnpm build:binding` that an
/// installed consumer has neither the command nor the Zig source for. Thrown from the
/// constructor it is an ordinary error the caller can catch, where they can still do
/// something about it.
function requireAddon(): void {
  loadAddon();
}

type BrandedServer = { readonly [SERVER_BRAND]?: true };

export function isServer(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as BrandedServer)[SERVER_BRAND] === true;
}

/// Builds the `ws`-shaped server record. The listener modes match upstream:
/// an explicit `port` owns an HTTP server answering 426 to plain requests, `server`
/// adopts the caller's, and `noServer` only accepts sockets passed to `handleUpgrade`.
///
/// The addon is loaded here, before anything is bound. Loading is lazy elsewhere so
/// importing ventijs does not fail for a program that never opens a socket.
export function createWebSocketServer(
  socketClass: ServerSocketConstructor,
  options?: ServerOptions,
  callback?: () => void,
): WebSocketServer {
  requireAddon();
  const resolved = {
    allowSynchronousEvents: true,
    autoPong: true,
    // `ws` defaults these three and they are observable on `server.options`, but
    // `@types/ws` declares none of them, so a consumer cannot name them without a
    // cast. Matching `ws` means inheriting the same gap in the type, which is
    // better than a runtime record that is a strict subset of the contract.
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
    // Truthiness, not `=== false`. `ws` gates tracking on `this.options.clientTracking`
    // being truthy, so `null`, `0`, and `""` all disable it; `?? true` read those as
    // absent and left tracking on, which put a `clients` set on the server where `ws`
    // has none and made `close()` wait for clients in a case where `ws` emits on the
    // next tick.
    clients: normalized.clientTracking ? new Set<WebSocket>() : undefined,
    webSocket: (resolved.WebSocket ?? socketClass) as ServerSocketConstructor,
    server: null,
    lifecycle: "running",
    record: null,
    shouldEmitClose: false,
    removeListeners: null,
    listeners: createRegistry<ServerEventMap>(),
    maxListeners: 10,
    warned: new Set<string>(),
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
    // `"clients" in server`, enumerates `Object.keys`, or spreads the record sees the
    // difference, and an empty set behaves differently again: `ws` reports `undefined`
    // where an empty set would give a size of 0.
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
