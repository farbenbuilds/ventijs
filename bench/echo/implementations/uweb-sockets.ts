import { createRequire } from "node:module";
import { WebSocket as WsSocket } from "ws";
import type * as UwsModule from "uWebSockets.js";
import type { WebSocket as UwsSocket } from "uWebSockets.js";
import type {
  EchoClient,
  EchoConnection,
  EchoImplementation,
  EchoServer,
  EchoServerOptions,
} from "../echo-types.ts";
import { wsEchoClient } from "./ws.ts";

type Uws = typeof UwsModule;

type UwsState = {
  onMessage: ((payload: Buffer) => void) | null;
  onError: ((error: Error) => void) | null;
};

const require = createRequire(import.meta.url);

// The pinned tag's ESM wrapper imports a file the tarball does not ship, so the
// addon is reached through require; only the type import uses the package entry.
const loadUws = (): Uws => require("uWebSockets.js") as Uws;

/// The uWS message ArrayBuffer is detached when its callback returns, and the
/// echo path sends synchronously, so `Buffer.from` is a view that is never
/// retained. uWS defaults to a 16 KiB payload limit and closes the socket on an
/// oversized message, so the ceiling is raised to the matrix maximum.
export const uwebSocketsServer = (options: EchoServerOptions): EchoServer => {
  const uws = loadUws();
  const app = uws.App();
  const states = new WeakMap<UwsSocket<unknown>, UwsState>();
  let onConnection: ((connection: EchoConnection) => void) | null = null;

  const stateOf = (socket: UwsSocket<unknown>): UwsState => {
    let state = states.get(socket);
    if (state === undefined) {
      state = { onMessage: null, onError: null };
      states.set(socket, state);
    }
    return state;
  };

  app.ws("/*", {
    compression: options.perMessageDeflate ? uws.DEDICATED_COMPRESSOR_32KB : uws.DISABLED,
    maxPayloadLength: options.maxPayloadBytes,
    open: (socket) => {
      const connection: EchoConnection = {
        send: (payload) => {
          socket.send(payload, true, false);
        },
        onMessage: (listener) => {
          stateOf(socket).onMessage = listener;
        },
        onError: (listener) => {
          stateOf(socket).onError = listener;
        },
      };
      onConnection?.(connection);
      onConnection = null;
    },
    message: (socket, message) => {
      stateOf(socket).onMessage?.(Buffer.from(message));
    },
    close: (socket, code) => {
      const state = states.get(socket);
      states.delete(socket);
      // uWS reports no per-connection error; a close before the sample settles
      // is the only signal that the leg died, so it fails the sample instead of
      // waiting out the deadline.
      state?.onError?.(new Error(`uWebSockets.js closed the connection with code ${code}`));
    },
  });

  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        try {
          app.listen(options.host, options.port, (token) => {
            if (token === false) {
              reject(new Error(`uWebSockets.js cannot listen on ${options.host}:${options.port}`));
              return;
            }
            resolve(uws.us_socket_local_port(token));
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    onConnection: (listener) => {
      onConnection = listener;
    },
    // uWS has no app-level error event; a failed listen or an aborted socket
    // surfaces through `listen` and the connection's close handler.
    onError: () => undefined,
    close: () => {
      app.close();
    },
  };
};

export const uwebSocketsImplementation = (): EchoImplementation => ({
  id: "uWebSockets.js",
  createServer: uwebSocketsServer,
  // uWebSockets.js v20 has no client API, so the shared ws client drives this
  // leg; the server is the only variable against the ws row.
  connect: (url: string): EchoClient =>
    wsEchoClient(new WsSocket(url, { perMessageDeflate: false })),
});
