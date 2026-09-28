import type { Duplex } from "node:stream";
import { CODEC_ROLE } from "../../binding/codec";
import type { ConnectionHandle } from "../../binding/handle";
import type { ServerHandle } from "../../binding/server";
import type { SocketState } from "../../types/socket";
import type { WebSocket } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, OPEN } from "../ready-state";
import { closeCodec, openCodec } from "./codec-handle";
import { driveInbound } from "./codec-inbound";
import { finishConnection } from "./lifecycle";
import { failTransport } from "./transport";
import { socketStateOf } from "./state";

/// Adopts a generation-checked native connection, after which socket operations route
/// through `src/binding/socket.ts`. The engine-thread drain that flushes the staging
/// ring lands with the message pump.
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
  // Already established, so the socket opens the moment it is adopted.
  openSocket(state);
}

/// Adopts an upgraded Node stream, opens its frame codec in the given role, opens the
/// socket, and hands it whatever arrived with the handshake. The codec is what reads the
/// peer from here, per `docs/adr/0001-transport-and-framing-ownership.md`.
export function attachSocket(
  socket: WebSocket,
  transport: Duplex,
  role?: number,
  pending?: Buffer,
): void {
  const state = socketStateOf(socket);
  if (state === undefined) {
    throw createError(
      "ERR_INVALID_HANDLE",
      "ventijs: attachSocket requires a ventijs socket record",
    );
  }
  // A stream that cannot be read or written is not a connection, and one reporting
  // `OPEN` is permanently `OPEN` with nothing on the wire: every send reports success
  // and `bufferedAmount` stays at zero.
  if (!transport.readable || !transport.writable) {
    transport.destroy();
    return;
  }
  state.transport = transport;
  openCodec(state, role ?? CODEC_ROLE.server);
  transport.on("end", () => {
    if (state.readyState !== CLOSED) state.readyState = CLOSING;
    transport.end();
  });
  transport.on("error", (error: Error) => {
    // Latch before destroying, matching `ws`: the terminal state is `CLOSING` from here,
    // not `OPEN` on a dead transport. The destroy runs in `finally` so a throwing
    // `emitEvent` cannot leave the transport open.
    try {
      failTransport(state, asCodedError(error));
    } finally {
      transport.destroy();
    }
  });
  transport.on("close", () => {
    // Released here rather than on the close event: the transport is gone, so nothing
    // can read or write through it, and holding the slot would leak one per connection.
    closeCodec(state);
    finishConnection(state, state.closeCode, state.closeReason);
  });
  // The order is the contract: the socket opens, and only then are the bytes that came
  // with the upgrade handed over. A peer greeting with a close frame in the same read
  // would otherwise see `close` before `open`.
  openSocket(state);
  driveInbound(state, transport, pending);
}

/// Private because the order relative to the codec's first read is this module's
/// decision, not a caller's: a caller opening the socket itself would have to know that
/// ordering exists to get it right.
function openSocket(state: SocketState): void {
  if (state.readyState === OPEN) return;
  state.readyState = OPEN;
  emitEvent(state, "open");
}

/// The guard stops a non-`Error` thrown by a custom stream reaching `emitEvent` as a
/// value the facade has no policy for.
function asCodedError(error: Error): Error {
  if (error instanceof Error) return error;
  return createError("ERR_PROTOCOL", `ventijs: the transport failed: ${String(error)}`);
}
