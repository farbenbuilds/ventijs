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
  /// The request is the only way to change a header on a hop that has not gone out yet.
  redirect: [url: string, request: ClientRequest];
  /// How a 401's `www-authenticate` is reached: a listener that returns without reading the response.
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
  /// Retained so `terminate()` can destroy it and the close event can latch; null for native attachments.
  transport: Duplex | null;
  /// Null outside a codec's lifetime, and for native attachments, which the engine frames itself.
  codec: bigint | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  /// On the socket because a server socket has no server to read them from.
  closeTimeout: number;
  /// `ws`'s `allowSynchronousEvents`, the same choice and the same default of true.
  allowSynchronousEvents: boolean;
  deliveryPaused: boolean;
  /// A *parse* pause, as in `ws`: the unheard message's frames stay unread. A queue rather than
  /// one read, because a peer sending faster than the application decides would otherwise have
  /// every later read discarded. Bounded by `maxBufferedChunks`, the read count `ws` bounds.
  pendingInput: Buffer[];
  maxBufferedChunks: number;
  /// `skipUTF8Validation` inverted, latched at creation: a codec is one connection.
  validateUtf8: boolean;
  /// Carried rather than read back because a socket outlives its codec.
  maxPayload: number;
  maxFragments: number; /// With `http.request` there is no socket until the 101, so `close()` on a `CONNECTING` client cancels it.
  cancelHandshake: (() => void) | null;
  /// Whether this connection negotiated RFC 7692 `permessage-deflate`, the only thing that may set RSV1.
  compressible: boolean;
  /// `ws` defaults the threshold to 1024 and spells "no threshold" as 0, so this does.
  threshold: number;
  autoPong: boolean;
  /// `ws`'s `generateMask`; client-side only, because a server never masks.
  generateMask: ((mask: Buffer) => void) | null;
  /// Held here so the client's per-frame send allocates nothing.
  maskScratch: Buffer;
};

export type SocketRegistry = Registry<SocketEventMap>;
