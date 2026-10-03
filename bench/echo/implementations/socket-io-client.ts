import { io as connectIo } from "socket.io-client";
import type { EchoClient } from "../echo-types.ts";
import { ECHO_EVENT, toBinaryBuffer } from "./socket-io-binary.ts";

export const socketIoClient = (url: string): EchoClient => {
  const socket = connectIo(url.replace(/^ws/, "http"), {
    transports: ["websocket"],
    // A retry would nest handshakes inside the measured window. The client
    // offers permessage-deflate by default, but the harness server answers with
    // it disabled, so the extension is never negotiated.
    reconnection: false,
  });
  return {
    send: (payload) => {
      socket.emit(ECHO_EVENT, payload);
    },
    close: () => {
      socket.close();
    },
    onOpen: (listener) => {
      socket.on("connect", listener);
    },
    onMessage: (listener) => {
      socket.on(ECHO_EVENT, (payload: unknown) => {
        const binary = toBinaryBuffer(payload);
        if (binary !== null) listener(binary);
      });
    },
    onError: (listener) => {
      socket.on("connect_error", (error: Error) => listener(error));
      socket.on("disconnect", (reason: string) =>
        listener(new Error(`Socket.IO disconnected: ${reason}`)),
      );
    },
  };
};
