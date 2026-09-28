import { socketBufferedAmount } from "../../binding/socket";
import { queuedBytes } from "./queued";
import type { CodedError } from "../../types/errors";
import type { SocketState } from "../../types/socket";
import type { ErrorStatus } from "../../types/status";
import { createError, createStatusError } from "../errors";

const READY_STATE_NAMES = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const;

export type SocketPayload = {
  readonly bytes: Buffer;
  readonly binary: boolean;
};

/// The `Buffer.from` argument surface `ws` documents. Enforced by `Buffer.from` itself,
/// which throws the same `TypeError` upstream.
export type BufferLikeSource = ArrayLike<number>;

/// Normalizes the `ws` payload surface. Blob payloads stay unsupported until the engine
/// owns blobs; `Buffer.from` rejects them with the same `TypeError` as upstream.
export function toPayload(data: unknown): SocketPayload {
  if (typeof data === "number") return { bytes: Buffer.from(String(data), "utf8"), binary: false };
  if (typeof data === "string") {
    return data.length === 0
      ? { bytes: Buffer.alloc(0), binary: false }
      : { bytes: Buffer.from(data, "utf8"), binary: false };
  }
  if (!data) return { bytes: Buffer.alloc(0), binary: true };
  return { bytes: toBytes(data), binary: true };
}

/// Reads a binary container as the byte sequence it represents, matching `ws`'s
/// `toBuffer`. An `ArrayBufferView` is read through `.buffer`, `.byteOffset` and
/// `.byteLength`, not element by element: `Buffer.from(view)` keeps one byte per element,
/// so a two-element `Uint16Array` would be 2 bytes where `ws` puts 4 on the wire.
function toBytes(data: unknown): Buffer {
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data as BufferLikeSource);
}

export function notOpenError(readyState: number): CodedError {
  const name = READY_STATE_NAMES[readyState] ?? "UNKNOWN";
  return createError(
    "ERR_SOCKET_NOT_OPEN",
    `WebSocket is not open: readyState ${readyState} (${name})`,
  );
}

export function statusError(status: ErrorStatus): CodedError {
  return createStatusError(status, `ventijs: socket operation failed with status "${status}"`);
}

/// A transport-owned socket has no staging ring, so it reads the transport's own queue;
/// see `queued.ts`.
export function bufferedAmountOf(state: SocketState): number {
  if (state.attachment === null) return queuedBytes(state);
  return socketBufferedAmount(state.attachment.server, state.attachment.connection);
}

/// `nextTick` keeps send and close callbacks off the caller's stack, matching the native
/// sender's completion timing.
export function defer(callback: unknown, error?: Error): void {
  if (typeof callback !== "function") return;
  process.nextTick(callback as (failure?: Error) => void, error);
}
