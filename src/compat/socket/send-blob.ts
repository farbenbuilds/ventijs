/// A `Blob` payload, which has to be read before it can be framed.
///
/// `ws` accepts a `Blob` and its API reference lists one as a valid `send` payload, so a
/// caller bridging browser code reaches this path. The read is asynchronous, which makes
/// this the one send shape that can fail after `send` has returned: the callback is the
/// only place the outcome is reported, exactly as in `ws` (`sender.js:439-478`).

import type { SocketState } from "../../types/socket";
import { OPEN } from "../ready-state";
import { createError } from "../errors";
import { defer, notOpenError } from "./payload";
import { framePayload } from "./send";

/// The minimum shape of a `Blob` this accepts, checked structurally because a global
/// `Blob` is absent on a Node build without it and a cross-realm one is not `instanceof`.
type BlobLike = {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function isBlob(value: unknown): value is BlobLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BlobLike).arrayBuffer === "function" &&
    typeof (value as BlobLike).size === "number"
  );
}

/// Reads the blob and sends its bytes. The options are passed through untouched so
/// `binary`, `compress`, `fin` and `mask` still mean what the caller said, except that a
/// blob is always binary: `ws` reads one as a buffer and never as text.
export function sendBlob(
  state: SocketState,
  blob: BlobLike,
  options: unknown,
  callback: unknown,
): void {
  if (state.readyState !== OPEN) {
    defer(callback, notOpenError(state.readyState));
    return;
  }
  const reading = blob
    .arrayBuffer()
    .then((buffer) => {
      if (state.readyState !== OPEN) {
        defer(callback, notOpenError(state.readyState));
        return;
      }
      // `framePayload`, not `sendData`: the latter queues behind this same read.
      framePayload(state, Buffer.from(buffer), { ...asOptions(options), binary: true }, callback);
    })
    .catch((error: unknown) => {
      defer(
        callback,
        error instanceof Error ? error : createError("ERR_INVALID_OPTION", String(error)),
      );
    })
    .finally(() => {
      if (state.pendingSend === reading) state.pendingSend = null;
    });
  state.pendingSend = reading;
}

/// Runs `work` after any blob read in flight, or now when there is none.
///
/// `ws` puts the read on its own sender queue, so a `send` issued after a blob waits behind
/// it and the two arrive in the order they were called. Without this the blob arrives after
/// every synchronous send that followed it.
export function afterPendingSend(state: SocketState, work: () => void): void {
  const pending = state.pendingSend;
  if (pending === null) {
    work();
    return;
  }
  state.pendingSend = pending.then(work, work);
}

function asOptions(options: unknown): Record<string, unknown> {
  return typeof options === "object" && options !== null ? { ...options } : {};
}
