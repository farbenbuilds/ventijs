import type { IncomingMessage } from "node:http";
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
  /// The URL a redirect would send the client to. `ws` passes its `ClientRequest` as a
  /// second argument; this client owns a `net.Socket` rather than an `http.ClientRequest`
  /// and has none to hand over, so the event carries the one thing a caller needs in
  /// order to decide, and `close()` is how it declines. The divergence is recorded in
  /// `docs/compliance-api.md`.
  redirect: [url: string];
  /// The URL that was refused and the status it was refused with, for the same reason.
  "unexpected-response": [url: string, status: number];
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
  /// Whether an outbound message is open, which a send with `fin: false` starts and
  /// the next send finishes. It is what decides the opcode of the next frame, because
  /// RFC 6455 section 5.4 requires a continuation to carry opcode 0 and a peer reads
  /// a second data frame with `fin` set as a second complete message.
  fragmentsOpen: boolean;
  errorEmitted: boolean;
  attachment: SocketAttachment | null;
  /// The upgraded Node stream, retained so `terminate()` can destroy it and
  /// the close event can latch. Null for native attachments.
  transport: Duplex | null;
  /// The frame codec for this connection, or null before one is opened and after
  /// one is released. Null for native attachments, which the engine frames itself.
  codec: bigint | null;
  /// The pending close-handshake deadline, or null when none is armed. A socket that
  /// is finished by the peer, by a refusal, or by `terminate` has to drop it, and the
  /// one place that knows which happened is the state itself.
  closeTimer: ReturnType<typeof setTimeout> | null;
  /// Milliseconds a close handshake on this socket may stay unfinished, resolved from
  /// the options that created it. On the socket rather than read from a server's
  /// options because a socket outlives the option record's scope, and a server socket
  /// has no server reference to read it from.
  closeTimeout: number;
  /// Whether `message`, `ping`, and `pong` are delivered on the read that decoded
  /// them or on a later tick. `ws`'s `allowSynchronousEvents` is the same choice, and
  /// its default is `true`, which is the synchronous path this state starts in.
  allowSynchronousEvents: boolean;
  /// The bytes a deferred delivery has not decoded yet, or null.
  ///
  /// A pause is a *parse* pause, which is what `ws` does: the frames behind the
  /// message the application has not heard about are not read until it has. The
  /// transport has already handed the chunk over, so the tail has to be held here for
  /// the resume to re-feed. At most one read's worth, so the cost is bounded and only
  /// for a socket that asked for deferred events.
  pendingInput: Buffer | null;
  /// Whether the codec validates a text payload as UTF-8, which is
  /// `skipUTF8Validation` read the other way round. Latched at codec creation because
  /// the validator is in Zig and a codec is one connection: changing it later would
  /// mean a second codec mid-connection.
  validateUtf8: boolean;
  /// Whether a ping is answered automatically. On the socket because the decision is
  /// made per frame in the inbound path, where the peer is known to be a client.
  autoPong: boolean;
};

export type SocketRegistry = Registry<SocketEventMap>;
