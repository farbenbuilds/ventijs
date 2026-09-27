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
};

export type EngineDispatch = (event: EngineEvent) => void;

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

export type VentiAddon = {
  engineVersion(): string;
  http3Available(): boolean;
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
  socketBufferedAmount(server: number, connection: bigint): number;
  /// Events the channel could not reserve or queue, including threadsafe
  /// function failures. The terminal reserve keeps close and shutdown events
  /// out of the regular drop set.
  serverDroppedEvents(server: number): bigint;
  /// Inbound messages the engine parsed and then had to discard because the
  /// Node main thread had not drained the inbound ring yet.
  serverDroppedMessages(server: number): bigint;
};
