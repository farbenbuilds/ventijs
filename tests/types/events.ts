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
  isPaused: false,
  isServer: true,
  closeCode: 1006,
  closeReason: Buffer.alloc(0),
  closeFrameSent: false,
  fragmentsOpen: false,
  allowSynchronousEvents: true,
  deliveryPaused: false,
  pendingInput: [],
  maxBufferedChunks: 256 * 1024,
  pendingSend: null,
  validateUtf8: true,
  maxPayload: 100 * 1024 * 1024,
  maxFragments: 16 * 1024,
  cancelHandshake: null,
  compressible: false,
  threshold: 0,
  closeFrameReceived: false,
  errorEmitted: false,
  attachment: null,
  transport: null,
  codec: null,
  closeTimer: null,
  closeTimeout: 30_000,
  autoPong: true,
  generateMask: null,
  maskScratch: Buffer.alloc(4),
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
