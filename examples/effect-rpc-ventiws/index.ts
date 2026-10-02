import { once } from "node:events";
import { Effect, ManagedRuntime } from "effect";
import { callServer } from "./client.ts";
import { RpcLive, wss } from "./server.ts";

await once(wss, "listening");

const address = wss.address();
if (address === null || typeof address === "string")
  throw new Error("WebSocketServer did not bind a TCP port");

const runtime = ManagedRuntime.make(RpcLive);

// Building the runtime starts the RPC protocol on the server's connections; the client
// then dials the ephemeral port the server bound.
await runtime.runPromise(Effect.void);
await runtime.runPromise(callServer(`ws://127.0.0.1:${address.port}/rpc`));
await runtime.dispose();
