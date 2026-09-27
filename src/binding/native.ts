export type EngineEventKind =
  | "listening"
  | "connectionOpen"
  | "connectionMessage"
  | "connectionClose"
  | "engineError"
  | "serverClosed";

/// One engine event. `code` is the bound port for `listening` and the staged
/// payload length for `connectionMessage`; it is 0 elsewhere.
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
  /// Negotiates RFC 7692 `permessage-deflate` on the route. The engine already
  /// reserves the paired deflate scratch for every configuration, so this turns
  /// reserved memory into function rather than asking for more.
  readonly permessageDeflate?: boolean;
};

export type EngineDispatch = (event: EngineEvent) => void;

/// One decoded frame from the codec, as `[kindOrdinal, closeCode, payload]`. The
/// ordinal tables are in `codec.ts`; the payload is already a Node-owned `Buffer`
/// because the copy happens on the native side of the boundary.
export type NativeCodecEvent = [number, number, Buffer];

/// Per-connection operation results mirrored from `socket.Status` in
/// `src/engine/socket/status.zig`. The ABI carries the enum ordinal; this array is
/// the ordinal-to-name table and must keep the Zig declaration order.
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

/// The capacities the addon was compiled with, read from the Zig comptime
/// constants rather than restated in TypeScript. A duplicated constant is how a
/// compiled limit and its documented value drift apart.
export type NativeEngineLimits = {
  readonly connectionCapacity: number;
  readonly messageBytes: number;
  readonly frameBytes: number;
  readonly inboundSlots: number;
  readonly outboundSlots: number;
};

export type VentiAddon = {
  engineVersion(): string;
  http3Available(): boolean;
  /// The compiled-in capacities. Takes no handle and cannot fail.
  engineLimits(): NativeEngineLimits;
  createServer(config: NativeServerConfig, dispatch: EngineDispatch): number;
  listenServer(server: number): void;
  closeServer(server: number): void;
  finalizeServer(server: number): void;
  /// Returns an ordinal into `NATIVE_SOCKET_STATUSES`; ordinals keep the
  /// per-message path free of string allocation.
  sendSocket(server: number, connection: bigint, data: Uint8Array, binary: boolean): number;
  closeSocket(server: number, connection: bigint, code: number, reason: Uint8Array): number;
  pauseSocket(server: number, connection: bigint): number;
  resumeSocket(server: number, connection: bigint): number;
  /// Hands one connection's staged payloads to the engine thread. Staging only
  /// copies bytes into a ring; this is what moves them onto the wire.
  pumpSocket(server: number, connection: bigint): number;
  /// Takes the oldest parsed message for a connection as
  /// `[buffer, isBinary]`, or null when nothing is staged.
  takeSocketMessage(server: number, connection: bigint): [Buffer, boolean] | null;
  /// Drops the staged inbound messages of a connection that has closed, so a
  /// departed peer cannot leave a record at the head of the inbound ring and stall
  /// every other connection behind it. Takes the index and generation from the
  /// `connectionClose` event rather than a connection handle, because the handle
  /// is already stale by the time the close is dispatched. Returns how many
  /// messages were dropped.
  purgeSocketMessage(server: number, index: number, generation: number): bigint;
  socketBufferedAmount(server: number, connection: bigint): number;
  /// Events the channel could not reserve or queue, including threadsafe
  /// function failures. The terminal reserve keeps close and shutdown events
  /// out of the regular drop set.
  serverDroppedEvents(server: number): bigint;
  /// Inbound messages the engine parsed and then had to discard because the
  /// Node main thread had not drained the inbound ring yet.
  serverDroppedMessages(server: number): bigint;
  /// Staged payloads the engine refused after the pump had taken them off the
  /// outbound ring. Non-zero means `pumpSocket` reported `ok` for bytes that never
  /// reached a peer, so this is the honest measure of outbound loss.
  serverUndeliveredMessages(server: number): bigint;

  /// The frame codec. Every codec has the compiled capacity, which `engineLimits`
  /// reports; the handle is generation-checked, so a call after `codecDestroy` is a
  /// status rather than a use-after-free.
  codecCreate(role: number): bigint;
  codecDestroy(handle: bigint): void;
  /// Returns bytes consumed, or a negative `codec.ts` outcome ordinal.
  codecFeed(handle: bigint, bytes: Uint8Array): number;
  /// Where the last `codecFeed` stopped, or a negative outcome ordinal.
  codecResume(handle: bigint): number;
  codecPending(handle: bigint): number;
  codecSelect(handle: bigint): boolean;
  codecEvent(handle: bigint): NativeCodecEvent | null;
  codecTake(handle: bigint): void;
  /// Returns the framed length, or a negative `codec.ts` encode-failure ordinal.
  codecEncode(handle: bigint, kind: number, fin: number, payload: Uint8Array): number;
  codecOutbound(handle: bigint): Buffer;
  codecOutboundMasked(handle: bigint): boolean;
  codecFailureCode(handle: bigint): number;
  codecReset(handle: bigint): void;
  codecRole(handle: bigint): number;
};
