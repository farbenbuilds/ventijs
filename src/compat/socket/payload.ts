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

/// The `Buffer.from` argument surface `ws` documents: "Object values are only
/// supported if they conform to the requirements of `Buffer.from()`". Enforced
/// by `Buffer.from` itself, which throws the same `TypeError` upstream.
export type BufferLikeSource = ArrayLike<number>;

/// Normalizes the `ws` payload surface. Numbers become text like `ws` does;
/// a falsy payload is the empty buffer; a binary container is read through its
/// byte view; everything else goes through `Buffer.from`, which enforces the
/// same BufferLike contract and throws the same `TypeError` for out-of-type
/// values. Blob payloads stay unsupported until the engine owns blobs;
/// `Buffer.from` rejects them.
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
/// `toBuffer`.
///
/// An `ArrayBufferView` is read through `.buffer`, `.byteOffset`, and
/// `.byteLength`. This is not a cosmetic difference: `Buffer.from(view)` copies
/// element by element and keeps one byte per element, so a two-element
/// `Uint16Array` becomes 2 bytes here and the 4 bytes `ws` puts on the wire. The
/// `Buffer` and `ArrayBuffer` cases produce a view over the caller's memory
/// rather than a copy, which is also what `ws` does; the staging ring copies
/// again before the bytes leave the process.
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

/// The staged bytes for a socket the engine owns.
///
/// A transport-owned socket has no staging ring to ask, so it reads the transport's
/// own queue instead; see `queued.ts`.
export function bufferedAmountOf(state: SocketState): number {
  if (state.attachment === null) return queuedBytes(state);
  return socketBufferedAmount(state.attachment.server, state.attachment.connection);
}

/// Schedules a `ws`-style callback. `nextTick` keeps send and close callbacks
/// off the caller's stack, matching the native sender's completion timing.
export function defer(callback: unknown, error?: Error): void {
  if (typeof callback !== "function") return;
  process.nextTick(callback as (failure?: Error) => void, error);
}
