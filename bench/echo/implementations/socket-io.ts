import type { EchoClient, EchoImplementation } from "../echo-types.ts";
import { socketIoClient } from "./socket-io-client.ts";
import { socketIoServer } from "./socket-io-server.ts";

export const socketIoImplementation = (): EchoImplementation => ({
  id: "socket.io",
  createServer: socketIoServer,
  connect: (url: string): EchoClient => socketIoClient(url),
});
