import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { logServerError, logServerListening, logServerPath } from "../../logging/lifecycle";
import type { ServerState } from "../../types/server";
import { emitEvent } from "../events/emitter";
import { handleUpgrade } from "./upgrade";

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

type ServerHandlers = {
  readonly onListening: () => void;
  readonly onError: (error: Error) => void;
  readonly onUpgrade: UpgradeHandler;
};

/// Routes upgrades through the same `handleUpgrade` path `noServer` callers use, so both
/// modes share one handshake implementation.
export function wireServer(state: ServerState): void {
  const httpServer = state.server;
  if (httpServer === null) return;
  const handlers: ServerHandlers = {
    onListening: (): void => {
      const address = state.server?.address();
      if (typeof address === "string") logServerPath(address);
      else logServerListening(typeof address === "object" && address !== null ? address.port : 0);
      emitEvent(state, "listening");
    },
    onError: (error: Error): void => {
      logServerError(error);
      emitEvent(state, "error", error);
    },
    onUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
      handleUpgrade(state, request, socket, head, (accepted, incoming) => {
        emitEvent(state, "connection", accepted, incoming);
      });
    },
  };
  httpServer.on("listening", handlers.onListening);
  httpServer.on("error", handlers.onError);
  httpServer.on("upgrade", handlers.onUpgrade);
  state.removeListeners = (): void => {
    httpServer.removeListener("listening", handlers.onListening);
    httpServer.removeListener("error", handlers.onError);
    httpServer.removeListener("upgrade", handlers.onUpgrade);
  };
}
