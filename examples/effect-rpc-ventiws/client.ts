import { Effect, Layer, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import type { RpcClientError } from "effect/rpc";
import { Socket } from "effect/socket";
import { AppRpc } from "./rpc.ts";

/// The client dials with the global `WebSocket` Node ships; only the server side runs on
/// ventiws in this example.
const ClientLive = (url: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(
      Socket.layerWebSocket(url).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    ),
  );

export const callServer = (url: string): Effect.Effect<void, RpcClientError.RpcClientError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AppRpc);

      const echo = yield* client.Echo({ message: "hello from the client" });
      yield* Effect.log(`client received: ${echo.message}`);

      const ticks = yield* client.Tick({ count: 3 }).pipe(Stream.runCollect);
      yield* Effect.log(`client received: ${ticks.length} ticks`);
    }),
  ).pipe(Effect.provide(ClientLive(url)));
