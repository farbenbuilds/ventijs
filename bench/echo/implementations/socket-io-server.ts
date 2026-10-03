import { createServer } from "node:http";
import { Server } from "socket.io";
import type { EchoConnection, EchoServer, EchoServerOptions } from "../echo-types.ts";
import { ECHO_EVENT, toBinaryBuffer } from "./socket-io-binary.ts";

const readPort = (address: { readonly port: number } | string | null): number => {
  if (address === null || typeof address === "string") {
    throw new Error("the server reported no TCP address");
  }
  return address.port;
};

/// Socket.IO is measured over its websocket transport only, so the number is a
/// websocket comparison; Engine.IO and Socket.IO framing still ride on every
/// message, and that overhead is the point of the row.
export const socketIoServer = (options: EchoServerOptions): EchoServer => {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    transports: ["websocket"],
    allowUpgrades: false,
    perMessageDeflate: options.perMessageDeflate,
    maxHttpBufferSize: options.maxPayloadBytes,
    serveClient: false,
  });
  const errors: ((error: Error) => void)[] = [];
  let onConnection: ((connection: EchoConnection) => void) | null = null;

  io.on("connection", (socket) => {
    const connectionErrors: ((error: Error) => void)[] = [];
    const connection: EchoConnection = {
      send: (payload) => {
        socket.emit(ECHO_EVENT, payload);
      },
      onMessage: (listener) => {
        socket.on(ECHO_EVENT, (payload: unknown) => {
          const binary = toBinaryBuffer(payload);
          if (binary === null) {
            for (const fail of connectionErrors) {
              fail(new Error("Socket.IO delivered a non-binary payload"));
            }
            return;
          }
          listener(binary);
        });
      },
      onError: (listener) => {
        connectionErrors.push(listener);
      },
    };
    socket.on("error", (error: Error) => {
      for (const fail of connectionErrors) fail(error);
    });
    socket.on("disconnect", (reason: string) => {
      for (const fail of connectionErrors) fail(new Error(`Socket.IO disconnected: ${reason}`));
    });
    onConnection?.(connection);
    onConnection = null;
  });

  httpServer.on("error", (error: Error) => {
    for (const fail of errors) fail(error);
  });

  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(options.port, options.host, () =>
          resolve(readPort(httpServer.address())),
        );
      }),
    onConnection: (listener) => {
      onConnection = listener;
    },
    onError: (listener) => {
      errors.push(listener);
    },
    close: () => {
      // `io.close()` also closes the attached HTTP server; the worker exits after
      // reporting, so the returned promise is deliberately not awaited here.
      void io.close();
    },
  };
};
