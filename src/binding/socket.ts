import type { EngineStatus } from "../types/status";
import type { ConnectionHandle } from "./handle";
import { NATIVE_SOCKET_STATUSES, type NativeSocketStatus } from "./native";
import { callNative } from "./errors";
import { assertConnectionHandle } from "./handle";
import { loadAddon } from "./load";
import { assertServerHandle, type ServerHandle } from "./server";

const MAX_UINT16 = 65_535;

const ENGINE_STATUS_BY_NATIVE: Readonly<Record<NativeSocketStatus, EngineStatus>> = {
  ok: "ok",
  closing: "closing",
  closed: "closed",
  backpressure: "backpressure",
  invalidHandle: "invalid-handle",
  payloadTooLarge: "payload-too-large",
  invalidCloseCode: "invalid-close-code",
  invalidCloseReason: "invalid-close-reason",
  protocolError: "protocol-error",
  policyViolation: "policy-violation",
};

function assertPayload(data: Uint8Array): void {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("ventijs: socket payload must be a Uint8Array");
  }
}

/// Decodes the ABI ordinal into a status. An ordinal outside the table is an
/// ABI mismatch between the loaded addon and this binding.
function statusFromOrdinal(ordinal: number): EngineStatus {
  const status = NATIVE_SOCKET_STATUSES[ordinal];
  if (status === undefined) {
    throw new RangeError(`ventijs: unknown native socket status ${ordinal}`);
  }
  return ENGINE_STATUS_BY_NATIVE[status];
}

function assertCloseCode(code: number): void {
  if (!Number.isInteger(code) || code < 0 || code > MAX_UINT16) {
    throw new RangeError(`ventijs: close code must be a uint16, got ${code}`);
  }
}

/// Stages one outbound text or binary message. The engine copies `data` into
/// its bounded staging ring before returning, so retaining or mutating the
/// buffer afterwards cannot affect the queued frame.
export function sendSocket(
  server: ServerHandle,
  connection: ConnectionHandle,
  data: Uint8Array,
  binary = false,
): EngineStatus {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  assertPayload(data);
  const addon = loadAddon();
  return statusFromOrdinal(callNative(() => addon.sendSocket(server, connection, data, binary)));
}

/// Validates the close code and reason, stages the close frame, and enters the
/// closing state. A second call reports `closing` instead of restaging.
export function closeSocket(
  server: ServerHandle,
  connection: ConnectionHandle,
  code: number,
  reason: Uint8Array,
): EngineStatus {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  assertCloseCode(code);
  assertPayload(reason);
  const addon = loadAddon();
  return statusFromOrdinal(callNative(() => addon.closeSocket(server, connection, code, reason)));
}

/// Suspends inbound message dispatch for the connection, matching `ws.pause()`.
export function pauseSocket(server: ServerHandle, connection: ConnectionHandle): EngineStatus {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  return statusFromOrdinal(callNative(() => addon.pauseSocket(server, connection)));
}

/// Resumes inbound message dispatch for the connection.
export function resumeSocket(server: ServerHandle, connection: ConnectionHandle): EngineStatus {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  return statusFromOrdinal(callNative(() => addon.resumeSocket(server, connection)));
}

/// Hands the connection's staged payloads to the engine thread.
///
/// `sendSocket` only copies bytes into the staging ring, so a caller that never
/// pumps would see `ok` and a growing `bufferedAmount` with nothing on the wire.
/// The engine copies the bytes out before the next loop iteration, so the ring
/// slot is free as soon as this returns and a partial flush is safe to retry.
export function pumpSocket(server: ServerHandle, connection: ConnectionHandle): EngineStatus {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  return statusFromOrdinal(callNative(() => addon.pumpSocket(server, connection)));
}

/// One parsed inbound message, copied into a Node-owned buffer.
///
/// The engine reuses its own message buffer for the next frame and frees the
/// ring slot here, so the returned buffer is the only copy and is safe to retain
/// past the handler. Null means nothing is staged, which happens when a wakeup
/// was coalesced or the event channel dropped its notification.
export function takeSocketMessage(
  server: ServerHandle,
  connection: ConnectionHandle,
): { readonly bytes: Buffer; readonly isBinary: boolean } | null {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  const taken = callNative(() => addon.takeSocketMessage(server, connection));
  if (taken === null) return null;
  return { bytes: taken[0], isBinary: taken[1] };
}

/// Bytes staged for the connection and not yet drained. A stale handle reads
/// zero, matching a closed `ws` socket.
export function socketBufferedAmount(server: ServerHandle, connection: ConnectionHandle): number {
  assertServerHandle(server);
  assertConnectionHandle(connection);
  const addon = loadAddon();
  return callNative(() => addon.socketBufferedAmount(server, connection));
}
