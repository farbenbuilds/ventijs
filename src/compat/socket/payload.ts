import { socketBufferedAmount } from "../../binding/socket";
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

/// Normalizes the `ws` payload surface, minus the blob, which `send.ts` routes to
/// `send-blob.ts` before this is reached: a blob has to be read before it can be framed.
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
/// `toBuffer`, which returns a `Buffer` unchanged: a copy here would put an allocation
/// and a memcpy inside every `send` of an already-native buffer. An `ArrayBufferView` is
/// read through `.buffer`, `.byteOffset` and `.byteLength`, not element by element:
/// `Buffer.from(view)` keeps one byte per element, so a two-element `Uint16Array` would
/// put 2 bytes on the wire where `ws` puts 4.
function toBytes(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
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
  return createStatusError(status, `ventiws: socket operation failed with status "${status}"`);
}

/// `ws` reports its sender's queue length, and a transport's is the same number:
/// `writableLength` is the one property on a Node stream that means "waiting to go out".
export function queuedBytes(state: SocketState): number {
  if (state.transport === null) return 0;
  return state.transport.writableLength;
}

/// A transport-owned socket has no staging ring, so it reads the transport's own queue.
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
