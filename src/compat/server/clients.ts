import type { ServerState } from "../../types/server";
import type { WebSocket } from "../../types/ws";
import { emitClose } from "./close";

/// Number of clients a tracking server is holding. A server built with
/// `clientTracking: false` has no set at all, matching `ws`, which only adds the
/// property when tracking is truthy.
export function clientCount(state: ServerState): number {
  return state.clients?.size ?? 0;
}

/// Adds an accepted socket to `server.clients` and removes it on close. When
/// `close()` was called first, the last client leaving releases the deferred
/// server `close` event.
export function trackClient(state: ServerState, socket: WebSocket): void {
  const clients = state.clients;
  if (clients === undefined) return;
  clients.add(socket);
  socket.once("close", () => {
    clients.delete(socket);
    if (state.shouldEmitClose && clients.size === 0) process.nextTick(() => emitClose(state));
  });
}
