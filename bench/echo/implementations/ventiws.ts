import { WebSocket as WsSocket } from "ws";
import type { EchoClient, EchoImplementation, EchoServerOptions } from "../echo-types.ts";
import { nativeEchoServer } from "../native-server.ts";
import { wsEchoClient } from "./ws.ts";

export const ventiwsImplementation = (): EchoImplementation => ({
  id: "ventiws",
  createServer: (options: EchoServerOptions) => nativeEchoServer(options),
  // ventiws client construction throws ERR_INVALID_STATE, so the ws client
  // drives this leg; the server is the only variable against the ws row.
  connect: (url: string): EchoClient =>
    wsEchoClient(new WsSocket(url, { perMessageDeflate: false })),
});
