import type { IncomingMessage } from "node:http";
import type * as ws from "../types/ws";
import type {
  ClientOptions,
  ServerOptions,
  WebSocket as WebSocketInstance,
  WebSocketServer as WebSocketServerInstance,
} from "../types/ws";
import { createWebSocketServer, isServer } from "./server/server";
import { createSocket, isSocket } from "./socket/socket";
import { createWebSocketStream } from "./stream";

type SocketConstructor = typeof ws.WebSocket;
type ServerConstructor = typeof ws.WebSocket.WebSocketServer;

function buildSocket(address: unknown, protocols?: unknown, options?: unknown): WebSocketInstance {
  if (new.target === undefined) {
    throw new TypeError("Class constructor WebSocket cannot be invoked without 'new'");
  }
  return createSocket(
    address as string | URL | null,
    protocols as string | string[] | undefined,
    options as ClientOptions | ServerOptions | undefined,
  );
}

function buildServer(options?: unknown, callback?: unknown): WebSocketServerInstance {
  if (new.target === undefined) {
    throw new TypeError("Class constructor WebSocketServer cannot be invoked without 'new'");
  }
  return createWebSocketServer(
    WebSocket as unknown as NonNullable<ServerOptions["WebSocket"]>,
    options as ServerOptions | undefined,
    callback as (() => void) | undefined,
  );
}

/// The `ws` classes' drop-in stand-ins: calling either with `new` returns the state record,
/// and `Symbol.hasInstance` reads the record brand, so `instanceof` passes with no
/// prototype chain.
const WebSocket: SocketConstructor = buildSocket as unknown as SocketConstructor;
type WebSocket = WebSocketInstance;
const WebSocketServer: ServerConstructor = buildServer as unknown as ServerConstructor;
type WebSocketServer = WebSocketServerInstance;

/// Re-exports the qualified type surface (`WebSocket.RawData`, `WebSocket.ServerOptions`,
/// ...) that `ws` consumers use. Type aliases carry no namespace, so the members are
/// restated once here, each resolving through the class namespace rather than the
/// module's top-level alias, which keeps the bundled declarations free of self-references.
namespace WebSocket {
  export type RawData = ws.WebSocket.RawData;
  export type Data = ws.WebSocket.Data;
  export type CertMeta = ws.WebSocket.CertMeta;
  export type VerifyClientCallbackSync<Request extends IncomingMessage = IncomingMessage> =
    ws.WebSocket.VerifyClientCallbackSync<Request>;
  export type VerifyClientCallbackAsync<Request extends IncomingMessage = IncomingMessage> =
    ws.WebSocket.VerifyClientCallbackAsync<Request>;
  export type FinishRequestCallback = ws.WebSocket.FinishRequestCallback;
  export type ClientOptions = ws.WebSocket.ClientOptions;
  export type PerMessageDeflateOptions = ws.WebSocket.PerMessageDeflateOptions;
  export type Event = ws.WebSocket.Event;
  export type ErrorEvent = ws.WebSocket.ErrorEvent;
  export type CloseEvent = ws.WebSocket.CloseEvent;
  export type MessageEvent = ws.WebSocket.MessageEvent;
  export type WebSocketEventMap = ws.WebSocket.WebSocketEventMap;
  export type EventListenerOptions = ws.WebSocket.EventListenerOptions;
  export type ServerOptions<
    U extends typeof ws.WebSocket = typeof ws.WebSocket,
    V extends typeof IncomingMessage = typeof IncomingMessage,
  > = ws.WebSocket.ServerOptions<U, V>;
  export type AddressInfo = ws.WebSocket.AddressInfo;
  export type Server<
    T extends typeof ws.WebSocket = typeof ws.WebSocket,
    U extends typeof IncomingMessage = typeof IncomingMessage,
  > = ws.WebSocket.Server<T, U>;
  export type WebSocketServer = WebSocketServerInstance;
  export type WebSocket = WebSocketInstance;
  export type createWebSocketStream = typeof ws.WebSocket.createWebSocketStream;
}

Object.defineProperty(WebSocket, Symbol.hasInstance, { value: isSocket });
Object.defineProperty(WebSocketServer, Symbol.hasInstance, { value: isServer });
// `ws` pins the ready-state constants; the remaining statics stay writable.
Object.defineProperties(WebSocket, {
  CONNECTING: { value: 0, enumerable: true },
  OPEN: { value: 1, enumerable: true },
  CLOSING: { value: 2, enumerable: true },
  CLOSED: { value: 3, enumerable: true },
});
Object.assign(WebSocket, {
  WebSocket,
  WebSocketServer,
  Server: WebSocketServer,
  createWebSocketStream,
});

export { WebSocket, WebSocketServer, createWebSocketStream };
