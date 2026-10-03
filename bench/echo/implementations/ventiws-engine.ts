import { WebSocket as WsSocket } from "ws";
import type { EchoClient, EchoImplementation, EchoServerOptions } from "../echo-types.ts";
import { nativeEchoServer } from "../native-server.ts";
import { wsEchoClient } from "./ws.ts";

/// The engine route: the native listener and the threaded engine, measured for the
/// reference row. The public surface does not use it (`CODEBASE.md`), so it is context
/// rather than the candidate.
export const ventiwsEngineImplementation = (): EchoImplementation => ({
  id: "ventiws-engine",
  createServer: (options: EchoServerOptions) => nativeEchoServer(options),
  connect: (url: string): EchoClient =>
    wsEchoClient(new WsSocket(url, { perMessageDeflate: false })),
});
