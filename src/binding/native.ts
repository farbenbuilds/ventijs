import type { NativeEngineLimits } from "./native-limits";
import type { NativeCodecAddon } from "./native-codec";

export type { NativeEngineLimits };
export type {
  NativeCodecAddon,
  NativeCodecEvent,
  NativeCodecInto,
  NativeCodecNext,
} from "./native-codec";

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
} & NativeCodecAddon;
