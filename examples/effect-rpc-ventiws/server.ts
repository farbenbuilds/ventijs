import { Effect, FiberSet, Layer, Result } from "effect";
import { NetAddress } from "effect/net";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";
import { WebSocketServer } from "ventiws";
import { AppRpc, RpcHandlers } from "./rpc.ts";

/// The custom `SocketServer` below follows maxostarr/express-effect-rpc's `wss.ts`, with
/// ventiws in place of `ws` and Effect 4's `effect/socket` in place of `@effect/platform`.
/// Reference: https://github.com/maxostarr/express-effect-rpc/blob/main/src/wss.ts
///
/// ventiws with a port owns the HTTP upgrade itself, so the example needs no Express or
/// `node:http` plumbing: the RPC protocol listens on the server's own connections.
export const wss = new WebSocketServer({ port: 0, path: "/rpc" });

const SocketServerLive = Layer.effect(
  SocketServer.SocketServer,
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => wss.close()));

    const address = wss.address();
    if (address === null || typeof address === "string") throw new Error("wss did not bind");
    const bound = Result.getOrThrow(
      NetAddress.inetAddressV4(NetAddress.ipv4Loopback, address.port),
    );

    /// The RPC protocol calls `run` once and hands it a handler that serves one socket until
    /// it closes. The run effect is scoped, so the fiber set that owns the connections dies
    /// with the layer.
    const run = <R, E, A>(
      handler: (socket: Socket.Socket) => Effect.Effect<A, E, R>,
    ): Effect.Effect<never, SocketServer.SocketServerError, R> =>
      Effect.scoped(
        Effect.gen(function* () {
          const fiberSet = yield* FiberSet.make();
          const runConnection = yield* FiberSet.runtime(fiberSet)<R>();

          const onConnection = (conn: Socket.WebSocketLike) =>
            Socket.fromWebSocket(
              Effect.acquireRelease(Effect.succeed(conn), (socket) =>
                Effect.sync(() => socket.close()),
              ),
            ).pipe(
              Effect.flatMap(handler),
              Effect.catchCause((cause) => Effect.logError("WebSocket connection failed", cause)),
              runConnection,
            );

          wss.on("connection", onConnection);
          yield* Effect.addFinalizer(() => Effect.sync(() => wss.off("connection", onConnection)));
          return yield* Effect.never;
        }),
      );

    return SocketServer.SocketServer.of({ address: bound, run });
  }),
);

const ProtocolLive = RpcServer.layerProtocolSocketServer.pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(SocketServerLive),
);

export const RpcLive = RpcServer.layer(AppRpc).pipe(
  Layer.provide(RpcHandlers),
  Layer.provide(ProtocolLive),
);
