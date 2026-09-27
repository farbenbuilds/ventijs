import type { Duplex } from "node:stream";
import type { ConnectionHandle } from "../../binding/handle";
import type { ServerHandle } from "../../binding/server";
import type { WebSocket } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, OPEN } from "../ready-state";
import { closeCodec, openCodec } from "./codec-handle";
import { driveInbound } from "./codec-inbound";
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

/// Adopts an upgraded Node stream and opens its frame codec.
///
/// The codec is what reads the peer from here: the transport's bytes go into it and
/// its events come out as the facade's, per
/// `docs/adr/0001-transport-and-framing-ownership.md`. Before the codec existed this
/// path dropped every inbound byte, which is a socket that accepts a connection and
/// then never hears from it.
export function attachSocket(socket: WebSocket, transport: Duplex): void {
  const state = socketStateOf(socket);
  if (state === undefined) {
    throw createError(
      "ERR_INVALID_HANDLE",
      "ventijs: attachSocket requires a ventijs socket record",
    );
  }
  state.transport = transport;
  openCodec(state);
  driveInbound(state, transport);
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
    // The codec is released here rather than on the close event: the transport is
    // gone, so nothing can read or write through it, and holding the slot until the
    // event drains would leak one per connection under load.
    closeCodec(state);
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
