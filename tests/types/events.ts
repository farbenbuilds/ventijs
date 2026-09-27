import { createRegistry, dispatchWith, subscribe } from "../../src/compat/events/registry";
import { normalizeServerOptions } from "../../src/compat/options/server";
import type { EventMap, EventName, Handler, Listener, Registry } from "../../src/types/events";
import type { ServerEventMap, ServerState } from "../../src/types/server";
import type { BinaryType, SocketEventMap, SocketState } from "../../src/types/socket";
import type { ServerOptions, WebSocket } from "../../src/types/ws";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

type HandlerTable<E extends EventMap> = {
  [K in keyof E]: Handler<E[K]>;
};

export const socketHandlers: HandlerTable<SocketEventMap> = {
  open: (): void => {},
  message: (data: WebSocket.RawData, isBinary: boolean): void => {
    void data;
    void isBinary;
  },
  close: (code: number, reason: Buffer): void => {
    void code;
    void reason;
  },
  error: (error: Error): void => {
    void error;
  },
  ping: (data: Buffer): void => {
    void data;
  },
  pong: (data: Buffer): void => {
    void data;
  },
  upgrade: (request: IncomingMessage): void => {
    void request;
  },
  redirect: (url: string, request: ClientRequest): void => {
    void url;
    void request;
  },
  "unexpected-response": (request: ClientRequest, response: IncomingMessage): void => {
    void request;
    void response;
  },
};

export const serverHandlers: HandlerTable<ServerEventMap> = {
  connection: (socket: WebSocket, request: IncomingMessage): void => {
    void socket;
    void request;
  },
  error: (error: Error): void => {
    void error;
  },
  headers: (headers: string[], request: IncomingMessage): void => {
    void headers;
    void request;
  },
  close: (): void => {},
  listening: (): void => {},
  wsClientError: (error: Error, socket: Duplex, request: IncomingMessage): void => {
    void error;
    void socket;
    void request;
  },
};

export const socketState: SocketState = {
  url: "ws://example.test",
  protocol: "",
  extensions: "",
  binaryType: "nodebuffer",
  readyState: 0,
  bufferedAmount: 0,
  isPaused: false,
  isServer: true,
  closeCode: 1006,
  closeReason: Buffer.alloc(0),
  closeFrameSent: false,
  closeFrameReceived: false,
  errorEmitted: false,
  attachment: null,
  transport: null,
  listeners: createRegistry<SocketEventMap>(),
  maxListeners: 10,
  warned: new Set<string>(),
  target: undefined,
};

const socketClass: NonNullable<ServerOptions["WebSocket"]> = null as never;

export const serverState: ServerState = {
  options: {},
  normalizedOptions: normalizeServerOptions({ noServer: true }),
  path: "/",
  clients: new Set<WebSocket>(),
  webSocket: socketClass,
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

export type SocketRegistry = Registry<SocketEventMap>;
export type ServerRegistry = Registry<ServerEventMap>;
export type SocketEventName = EventName<SocketEventMap>;
export type MessageListener = Listener<SocketEventMap, "message">;
export type OpenHandlers = Registry<SocketEventMap>["open"];
export type SocketBinaryType = BinaryType;

export function registerMessage(
  socket: SocketState,
  handler: Handler<SocketEventMap["message"]>,
): SocketState {
  return { ...socket, listeners: subscribe(socket.listeners, "message", handler) };
}

export function announceClose(socket: SocketState): number {
  return dispatchWith(socket.listeners, socket, "close", 1000, Buffer.from("done"));
}

export function announceOpen(): number {
  return dispatchWith(createRegistry<SocketEventMap>(), undefined, "open");
}
