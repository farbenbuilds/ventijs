import type { IncomingMessage, ClientRequest } from "node:http";
import type { Duplex } from "node:stream";
import type { ConnectionHandle } from "../binding/handle";
import type { ServerHandle } from "../binding/server";
import type { ReadyState } from "./close";
import type { EmitterState, Registry } from "./events";
import type { WebSocket } from "./ws";

/// Binary payload views the socket can produce, as `@types/ws` declares them.
export type BinaryType = "nodebuffer" | "arraybuffer" | "fragments";

/// The same union widened by the one value `ws` accepts at runtime but the
/// vendored types omit: `binaryType = "blob"` is legal wherever the `Blob`
/// global exists. The record holds this and the public getter narrows to
/// `BinaryType`, so the state is never typed as a value it can hold wrongly.
export type BinaryTypeValue = BinaryType | "blob";

export type SocketEventMap = {
  open: [];
  message: [data: WebSocket.RawData, isBinary: boolean];
  close: [code: number, reason: Buffer];
  error: [error: Error];
  ping: [data: Buffer];
  pong: [data: Buffer];
  upgrade: [request: IncomingMessage];
  redirect: [url: string, request: ClientRequest];
  "unexpected-response": [request: ClientRequest, response: IncomingMessage];
};

/// The generation-checked handles a native connection routes through. A
/// socket created by the Node upgrade path carries no attachment until the
/// engine adoption boundary lands.
export type SocketAttachment = {
  readonly server: ServerHandle;
  readonly connection: ConnectionHandle;
};

export type SocketState = EmitterState<SocketEventMap> & {
  url: string;
  protocol: string;
  extensions: string;
  binaryType: BinaryTypeValue;
  readyState: ReadyState;
  bufferedAmount: number;
  isPaused: boolean;
  isServer: boolean;
  closeCode: number;
  closeReason: Buffer;
  closeFrameSent: boolean;
  closeFrameReceived: boolean;
  errorEmitted: boolean;
  attachment: SocketAttachment | null;
  /// The upgraded Node stream, retained so `terminate()` can destroy it and
  /// the close event can latch. Null for native attachments.
  transport: Duplex | null;
};

export type SocketRegistry = Registry<SocketEventMap>;
