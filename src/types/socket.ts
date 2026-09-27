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
/// global exists.
///
/// The record is typed as this and the getter reports it as this, so the state is
/// never typed as a value it cannot hold. The public surface is narrowed by
/// `createSocket`'s return annotation rather than by the getter, which is where
/// the vendored contract's own omission of `"blob"` belongs.
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
  /// The frame codec for this connection, or null before one is opened and after
  /// one is released. Null for native attachments, which the engine frames itself.
  codec: bigint | null;
};

export type SocketRegistry = Registry<SocketEventMap>;
