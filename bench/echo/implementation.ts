import type { EchoImplementation, ImplementationId } from "./echo-types.ts";

type ImplementationFactory = () => Promise<EchoImplementation>;

// Lazy imports keep a reference package that cannot load from failing the whole
// run: the worker reports that leg unavailable and the other legs still measure.
const FACTORIES: Readonly<Record<ImplementationId, ImplementationFactory>> = {
  ws: async () => (await import("./implementations/ws.ts")).wsImplementation(),
  ventiws: async () => (await import("./implementations/ventiws.ts")).ventiwsImplementation(),
  "uWebSockets.js": async () =>
    (await import("./implementations/uweb-sockets.ts")).uwebSocketsImplementation(),
  "socket.io": async () =>
    (await import("./implementations/socket-io.ts")).socketIoImplementation(),
};

export const resolveImplementation = (id: ImplementationId): Promise<EchoImplementation> =>
  FACTORIES[id]();
