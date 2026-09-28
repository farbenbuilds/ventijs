import type { NativeEngineLimits } from "./native-limits";

export type { NativeEngineLimits };

export type EngineEventKind =
  | "listening"
  | "connectionOpen"
  | "connectionMessage"
  | "connectionClose"
  | "engineError"
  | "serverClosed";

/// `code` is the bound port for `listening`, the staged payload length for `connectionMessage`, 0 elsewhere.
export type EngineEvent = {
  readonly kind: EngineEventKind;
  readonly server: number;
  readonly index: number;
  readonly generation: number;
  readonly code: number;
};

export type NativeServerConfig = {
  readonly host?: string;
  readonly port: number;
  readonly backlog?: number;
  readonly path?: string;
  readonly maxConnections?: number;
  readonly maxMessageBytes?: number;
  readonly maxFrameBytes?: number;
  /// The engine reserves the deflate scratch for every configuration, so this turns reserved memory into function.
  readonly permessageDeflate?: boolean;
};

export type EngineDispatch = (event: EngineEvent) => void;

/// One decoded frame as `[kindOrdinal, closeCode, payload]`; the payload is already a Node-owned `Buffer`.
export type NativeCodecEvent = [number, number, Buffer];

/// Mirrored from `socket.Status` in `src/engine/socket/status.zig`; the ABI carries the ordinal, so keep the order.
export const NATIVE_SOCKET_STATUSES = [
  "ok",
  "closing",
  "closed",
  "backpressure",
  "invalidHandle",
  "payloadTooLarge",
  "invalidCloseCode",
  "invalidCloseReason",
  "protocolError",
  "policyViolation",
] as const;

export type NativeSocketStatus = (typeof NATIVE_SOCKET_STATUSES)[number];

export type VentiAddon = {
  engineVersion(): string;
  http3Available(): boolean;
  /// The compiled-in capacities. Takes no handle and cannot fail.
  engineLimits(): NativeEngineLimits;
  createServer(config: NativeServerConfig, dispatch: EngineDispatch): number;
  listenServer(server: number): void;
  closeServer(server: number): void;
  finalizeServer(server: number): void;
  /// An ordinal into `NATIVE_SOCKET_STATUSES`, keeping the per-message path free of string allocation.
  sendSocket(server: number, connection: bigint, data: Uint8Array, binary: boolean): number;
  closeSocket(server: number, connection: bigint, code: number, reason: Uint8Array): number;
  pauseSocket(server: number, connection: bigint): number;
  resumeSocket(server: number, connection: bigint): number;
  /// Staging only copies bytes into a ring; this moves one connection's payloads onto the wire.
  pumpSocket(server: number, connection: bigint): number;
  /// The oldest parsed message for a connection as `[buffer, isBinary]`, or null when nothing is staged.
  takeSocketMessage(server: number, connection: bigint): [Buffer, boolean] | null;
  /// Drops a closed connection's staged inbound messages, so a stranded head does not stall every
  /// other connection behind it. Takes the `connectionClose` index and generation, not a stale handle.
  purgeSocketMessage(server: number, index: number, generation: number): bigint;
  socketBufferedAmount(server: number, connection: bigint): number;
  /// The terminal reserve keeps close and shutdown out of the regular drop set.
  serverDroppedEvents(server: number): bigint;
  /// Inbound messages the engine parsed and then discarded: the main thread had not drained the ring.
  serverDroppedMessages(server: number): bigint;
  /// Staged payloads the engine refused after the pump took them off the ring. Non-zero means
  /// `pumpSocket` reported `ok` for bytes that never reached a peer.
  serverUndeliveredMessages(server: number): bigint;

  /// The frame codec. A ceiling above `engineLimits()`' is refused rather than clamped, so a
  /// caller cannot believe it negotiated a limit the codec is not enforcing. The handle is
  /// generation-checked, so a call after `codecDestroy` is a status, not a use-after-free.
  /// `validateUtf8` is 1 unless the caller passed `skipUTF8Validation`; the codec is the validator.
  codecCreate(
    role: number,
    validateUtf8: number,
    maxPayload: number,
    maxFragments: number,
    permessageDeflate: number,
  ): bigint;
  codecDestroy(handle: bigint): void;
  /// Returns bytes consumed, or a negative `codec.ts` outcome ordinal.
  codecFeed(handle: bigint, bytes: Uint8Array): number;
  /// Where the last `codecFeed` stopped, or a negative outcome ordinal.
  codecResume(handle: bigint): number;
  codecPending(handle: bigint): number;
  codecSelect(handle: bigint): boolean;
  codecEvent(handle: bigint): NativeCodecEvent | null;
  /// The fragment boundaries of the selected data message, or null when it arrived whole.
  codecFragments(handle: bigint): number[] | null;
  codecTake(handle: bigint): void;
  /// Returns the framed length, or a negative `codec.ts` encode-failure ordinal.
  /// `compress` asks for RSV1 and is declined for a control frame or a fragment.
  /// `maskFrame` is 0 for a caller that asked for an unmasked frame, which `ws` allows a
  /// client to do with `send`'s `mask` option. `mask` is `generateMask`: four caller bytes,
  /// or empty to draw one here, and is read only when `maskFrame` is set.
  codecEncode(
    handle: bigint,
    kind: number,
    fin: number,
    payload: Uint8Array,
    compress: number,
    maskFrame: number,
    mask: Uint8Array,
  ): number;
  codecOutbound(handle: bigint): Buffer;
  codecOutboundMasked(handle: bigint): boolean;
  codecFailureCode(handle: bigint): number;
  codecFailure(handle: bigint): number;
  codecReset(handle: bigint): void;
  codecRole(handle: bigint): number;
  /// The per-connection ceilings, or null once the handle is stale. Read back rather than
  /// echoed: `maxPayload: 0` is `ws`'s "no limit" and arrives as the ceiling.
  codecCeilings(handle: bigint): [number, number] | null;
};
