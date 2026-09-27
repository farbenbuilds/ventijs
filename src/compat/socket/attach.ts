import type { Duplex } from "node:stream";
import type { ConnectionHandle } from "../../binding/handle";
import type { ServerHandle } from "../../binding/server";
import type { WebSocket } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, OPEN } from "../ready-state";
import { finishConnection } from "./lifecycle";
import { failTransport } from "./transport";
import { socketStateOf } from "./state";

/// Adopts a generation-checked native connection. Socket operations then
/// route through `src/binding/socket.ts`; the engine-thread drain that flushes
/// the staging ring lands with the message pump.
export function attachNativeSocket(
  socket: WebSocket,
  server: ServerHandle,
  connection: ConnectionHandle,
): void {
  const state = socketStateOf(socket);
  if (state === undefined) {
    throw createError(
      "ERR_INVALID_HANDLE",
      "ventijs: attachNativeSocket requires a ventijs socket record",
    );
  }
  state.attachment = { server, connection };
  state.readyState = OPEN;
  emitEvent(state, "open");
}

/// Adopts an upgraded Node stream. The transport wiring keeps the terminal
/// latch and `terminate()` functional while the native receiver is pending;
/// bytes in `head` are dropped until it owns the socket.
export function attachSocket(socket: WebSocket, transport: Duplex): void {
  const state = socketStateOf(socket);
  if (state === undefined) {
    throw createError(
      "ERR_INVALID_HANDLE",
      "ventijs: attachSocket requires a ventijs socket record",
    );
  }
  state.transport = transport;
  transport.on("end", () => {
    if (state.readyState !== CLOSED) state.readyState = CLOSING;
    transport.end();
  });
  transport.on("error", (error: Error) => {
    // Latch before destroying, matching `ws`'s socket error path: the terminal
    // state is `CLOSING` from here, not `OPEN` on a dead transport. The destroy
    // runs in `finally` so an unhandled `error` listener, which `emitEvent`
    // throws on, cannot leave the transport open.
    try {
      failTransport(state, asCodedError(error));
    } finally {
      transport.destroy();
    }
  });
  transport.on("close", () => {
    finishConnection(state, state.closeCode, state.closeReason);
  });
  state.readyState = OPEN;
  emitEvent(state, "open");
}

/// Node hands a stream `error` an `Error`, and a `net.Socket` error already
/// carries the syscall code that makes it diagnosable. The guard exists so a
/// non-`Error` thrown by a custom stream cannot reach `emitEvent` as a value
/// the facade has no policy for.
function asCodedError(error: Error): Error {
  if (error instanceof Error) return error;
  return createError("ERR_PROTOCOL", `ventijs: the transport failed: ${String(error)}`);
}
