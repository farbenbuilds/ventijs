import { clientCount } from "./clients";
import type { ServerState } from "../../types/server";
import type { AddressInfo } from "../../types/ws";
import { emitEvent } from "../events/emitter";
import { onceEvent } from "../events/tags";
import { createError } from "../errors";

/// Latches the terminal server state before dispatch so a repeated close
/// request cannot emit `close` twice, then emits it once.
export function emitClose(state: ServerState): void {
  if (state.lifecycle === "closed") return;
  state.lifecycle = "closed";
  emitEvent(state, "close");
}

/// `ws` emits a second `close` when `close()` is called on a stopped server,
/// which is how a late callback learns the server was not running.
export function emitCloseAgain(state: ServerState): void {
  emitEvent(state, "close");
}

export function detachServer(state: ServerState): void {
  if (state.removeListeners !== null) state.removeListeners();
  state.removeListeners = null;
  state.server = null;
}

export function addressOf(state: ServerState): AddressInfo | string | null {
  if (state.normalizedOptions.noServer) {
    throw createError("ERR_INVALID_STATE", 'The server is operating in "noServer" mode');
  }
  if (state.server === null) return null;
  return state.server.address() as AddressInfo | string | null;
}

/// Mirrors `ws` close semantics: the callback is a one-time `close` listener,
/// a closed server still schedules a `close` with the "not running" error,
/// and externally owned HTTP servers are detached while their sockets drain.
export function closeWebSocketServer(state: ServerState, callback?: (error?: Error) => void): void {
  if (state.lifecycle === "closed") {
    if (callback) {
      onceEvent(state, "close", () => {
        callback(createError("ERR_SOCKET_CLOSED", "The server is not running"));
      });
    }
    process.nextTick(() => {
      emitCloseAgain(state);
    });
    return;
  }
  if (callback) {
    onceEvent(state, "close", () => {
      callback();
    });
  }
  if (state.lifecycle === "closing") return;
  state.lifecycle = "closing";
  const external = state.normalizedOptions.noServer || state.normalizedOptions.server !== null;
  if (external) {
    detachServer(state);
    if (!state.normalizedOptions.clientTracking || clientCount(state) === 0) {
      process.nextTick(() => {
        emitClose(state);
      });
      return;
    }
    state.shouldEmitClose = true;
    return;
  }
  const httpServer = state.server;
  detachServer(state);
  httpServer?.close(() => {
    emitClose(state);
  });
}
