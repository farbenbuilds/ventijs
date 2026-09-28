import type { ClientRequest, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ConnectionHandle } from "../binding/handle";
import type { ServerHandle } from "../binding/server";
import type { ReadyState } from "./close";
import type { EmitterState, Registry } from "./events";
import type { WebSocket } from "./ws";

export type BinaryType = "nodebuffer" | "arraybuffer" | "fragments";

/// `BinaryType` widened by `"blob"`, which `ws` takes at runtime and `@types/ws` omits.
export type BinaryTypeValue = BinaryType | "blob";

export type SocketEventMap = {
  open: [];
  message: [data: WebSocket.RawData, isBinary: boolean];
  close: [code: number, reason: Buffer];
  error: [error: Error];
  ping: [data: Buffer];
  pong: [data: Buffer];
  upgrade: [request: IncomingMessage];
  /// The only way to change a header on a hop that has not gone out yet.
  redirect: [url: string, request: ClientRequest];
  /// How a 401's `www-authenticate` is read, by a listener that returns without reading it.
  "unexpected-response": [request: ClientRequest, response: IncomingMessage];
};

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
  isPaused: boolean;
  isServer: boolean;
  closeCode: number;
  closeReason: Buffer;
  closeFrameSent: boolean;
  closeFrameReceived: boolean;
  /// RFC 6455 section 5.4: a continuation is opcode 0, so a second `fin` frame is a second message.
  fragmentsOpen: boolean;
  errorEmitted: boolean;
  attachment: SocketAttachment | null;
  /// So `terminate()` can destroy it and `close` can latch; null for a native one.
  transport: Duplex | null;
  /// Null outside a codec's lifetime, and for a native attachment, which frames itself.
  codec: bigint | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  /// On the socket, which has no server to read it from.
  closeTimeout: number;
  /// `ws`'s `allowSynchronousEvents`, same choice and same default.
  allowSynchronousEvents: boolean;
  deliveryPaused: boolean;
  /// A *parse* pause, as in `ws`: unheard frames stay unread, queued rather than dropped.
  pendingInput: Buffer[];
  /// `skipUTF8Validation` inverted, latched at creation: a codec is one connection.
  validateUtf8: boolean;
  /// Carried, not read back: a socket outlives its codec.
  maxPayload: number;
  maxFragments: number;
  /// `close()` on a `CONNECTING` client cancels the request; there is no socket until the 101.
  cancelHandshake: (() => void) | null;
  /// A blob read in flight, which stops a later `send` from overtaking it.
  pendingSend: Promise<void> | null;
  /// The read count `ws` bounds `pendingInput` at. Zero is no limit.
  maxBufferedChunks: number;
  /// Whether RFC 7692 was negotiated; only it may set RSV1.
  compressible: boolean;
  /// `ws` defaults it to 1024 and spells "no threshold" as 0.
  threshold: number;
  autoPong: boolean;
  /// `ws`'s `generateMask`, client-side only: a server never masks. `maskScratch` is its key
  /// buffer, so the per-frame call allocates nothing.
  generateMask: ((mask: Buffer) => void) | null;
  maskScratch: Buffer;
};

export type SocketRegistry = Registry<SocketEventMap>;
