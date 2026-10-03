import { Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const EchoRpc = Rpc.make("Echo", {
  payload: Schema.Struct({ message: Schema.String }),
  success: Schema.Struct({ message: Schema.String }),
});

/// `stream: true` turns the handler's return value into a `Stream`, so the client receives
/// tick elements as they are produced rather than one collected response.
export const TickRpc = Rpc.make("Tick", {
  payload: Schema.Struct({ count: Schema.Number }),
  success: Schema.Struct({ value: Schema.Number }),
  stream: true,
});

export const AppRpc = RpcGroup.make(EchoRpc, TickRpc);

export const RpcHandlers = AppRpc.toLayer({
  Echo: ({ message }) => Effect.succeed({ message: `echo: ${message}` }),
  Tick: ({ count }) =>
    Stream.fromIterable(Array.from({ length: count }, (_, value) => ({ value }))),
});
