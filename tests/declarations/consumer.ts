import type WebSocketDefault from "ventijs";
import WebSocketValueDefault, {
  WebSocket as WebSocketValue,
  WebSocketServer as WebSocketServerValue,
  createWebSocketStream as createStream,
  engineLimits as readEngineLimits,
} from "ventijs";
import type {
  AddressInfo,
  ClientOptions,
  EngineLimits,
  CloseEvent,
  ErrorEvent,
  Event,
  EventListenerOptions,
  MessageEvent,
  PerMessageDeflateOptions,
  RawData,
  Server,
  ServerOptions,
  VerifyClientCallbackAsync,
  WebSocket,
  WebSocketServer,
  createWebSocketStream,
} from "ventijs";

export type DefaultSocket = WebSocketDefault;
export type DefaultServer = Server;
export type CreateConnection = NonNullable<ClientOptions["createConnection"]>;
export type MessageHandler = (data: RawData, isBinary: boolean) => void;
export type QualifiedRawData = WebSocket.RawData;
export type QualifiedClientOptions = WebSocket.ClientOptions;
export type Limits = EngineLimits;

export const rawData: RawData = Buffer.from("payload");
export const textData: WebSocket.Data = "payload";
export const deflateOptions: PerMessageDeflateOptions = {
  threshold: 1024,
  serverNoContextTakeover: true,
};
export const clientOptions: ClientOptions = {
  perMessageDeflate: deflateOptions,
  handshakeTimeout: 5_000,
  maxPayload: 1_048_576,
};

export const verifyClient: VerifyClientCallbackAsync = (info, callback) => {
  callback(info.secure && info.origin.endsWith(".test"));
};

export const serverOptions: ServerOptions = {
  noServer: true,
  clientTracking: true,
  perMessageDeflate: deflateOptions,
  verifyClient,
};

export const serverClientCount = (server: WebSocketServer): number => server.clients.size;
export const closeCodeOf = (event: CloseEvent): number => event.code;
export const messageDataOf = (event: MessageEvent): WebSocket.Data => event.data;
export const binaryTypeOf = (socket: WebSocket): WebSocket["binaryType"] => socket.binaryType;
export const readyStateOf = (socket: WebSocket): WebSocket["readyState"] => socket.readyState;

export type StreamFactory = typeof createWebSocketStream;
export type EventListener = EventListenerOptions;
export type Address = AddressInfo;
export type ErrorEvt = ErrorEvent;
export type GenericEvent = Event;

// Runtime values keep both the construct signatures and the instance type
// meanings that the `ws` class surface exposes.
export const socket: WebSocket = new WebSocketValue(null);
export const defaultSocket: WebSocketDefault = new WebSocketValueDefault(null);
export const server: WebSocketServer = new WebSocketServerValue({ noServer: true });
export const isSocket = (value: unknown): boolean => value instanceof WebSocketValue;
export const isServer = (value: unknown): boolean => value instanceof WebSocketServerValue;
export const stream = createStream(socket);
// The compiled capacities, readable from the package entry rather than from a deep
// import: a documented snippet that has to name an internal path is a snippet nobody runs.
export const limits: EngineLimits = readEngineLimits();
export const messageBytes: number = limits.messageBytes;

// Negative cases: a widening regression would make these compile.
// @ts-expect-error RawData is never a plain string
export const badRawData: RawData = "payload";
// @ts-expect-error Data is never a number
export const badData: WebSocket.Data = 1;
