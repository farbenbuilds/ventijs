import type { ClientRequest, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ConnectionHandle } from "../binding/handle";
import type { ServerHandle } from "../binding/server";
import type { ReadyState } from "./close";
import type { EmitterState, Registry } from "./events";
import type { WebSocket } from "./ws";

export type BinaryType = "nodebuffer" | "arraybuffer" | "fragments";

/// `BinaryType` widened by `"blob"`, which `ws` accepts at runtime but the vendored types omit.
export type BinaryTypeValue = BinaryType | "blob";

export type SocketEventMap = {
  open: [];
  message: [data: WebSocket.RawData, isBinary: boolean];
  close: [code: number, reason: Buffer];
  error: [error: Error];
  ping: [data: Buffer];
  pong: [data: Buffer];
  upgrade: [request: IncomingMessage];
  /// The URL is what a caller checks against its own policy, and the request is the only way
  /// to change a header on a hop that has not gone out yet.
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
  /// RFC 6455 section 5.4 requires a continuation to carry opcode 0, and a peer reads a second
  /// `fin`-set data frame as a second complete message.
  fragmentsOpen: boolean;
  errorEmitted: boolean;
  attachment: SocketAttachment | null;
  /// Retained so `terminate()` can destroy it and the close event can latch; null for native attachments.
  transport: Duplex | null;
  /// Null outside a codec's lifetime, and for native attachments, which the engine frames itself.
  codec: bigint | null;
  /// A socket finished by the peer, by a refusal, or by `terminate` has to drop it.
  closeTimer: ReturnType<typeof setTimeout> | null;
  /// On the socket because a server socket has no server to read them from.
  closeTimeout: number;
  /// `ws`'s `allowSynchronousEvents`, the same choice and the same default of true.
  allowSynchronousEvents: boolean;
  deliveryPaused: boolean;
  /// A pause is a *parse* pause, as in `ws`: frames behind the message the application has not
  /// heard about are not read until it has. Bounded to one read's worth.
  pendingInput: Buffer | null;
  /// `skipUTF8Validation` read the other way round. Latched at creation because the validator is
  /// in Zig and a codec is one connection, so changing it means a second codec mid-stream.
  validateUtf8: boolean;
  /// Carried rather than read back because a socket outlives its codec.
  maxPayload: number;
  maxFragments: number;
  /// With `http.request` there is no socket until the 101, so `close()` on a `CONNECTING` client cancels it.
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
