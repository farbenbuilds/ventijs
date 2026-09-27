import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { EmitterState, Registry } from "./events";
import type { NormalizedServerOptions } from "./options";
import type { ServerOptions, WebSocket } from "./ws";

export type ServerEventMap = {
  connection: [socket: WebSocket, request: IncomingMessage];
  error: [error: Error];
  headers: [headers: string[], request: IncomingMessage];
  close: [];
  listening: [];
  wsClientError: [error: Error, socket: Duplex, request: IncomingMessage];
};

export type ServerLifecycle = "running" | "closing" | "closed";

/// The constructor `handleUpgrade` instantiates per accepted request. It is
/// resolved once by the factory so a custom `WebSocket` option is honored.
export type ServerSocketConstructor = NonNullable<ServerOptions["WebSocket"]>;

/// The part of the server record the upgrade path resolves at call time.
export type ServerRouting = {
  shouldHandle?: (request: IncomingMessage) => boolean;
};

export type ServerState = EmitterState<ServerEventMap> & {
  /// The defaulted public record `ws` exposes as `server.options`.
  readonly options: ServerOptions;
  /// The trusted record the factory passes to the binding and upgrade path.
  readonly normalizedOptions: NormalizedServerOptions;
  readonly path: string;
  /// `ws` only adds this property when `clientTracking` is truthy, so a server
  /// built with tracking off reports `undefined` rather than an empty set.
  readonly clients: Set<WebSocket> | undefined;
  /// The server record, narrowed to the routing surface `handleUpgrade` reads.
  ///
  /// `ws` calls `this.shouldHandle(request)`, so an override is an assignment to
  /// the record's own property and the decision has to resolve that property when
  /// the request arrives. A predicate captured at construction made the
  /// documented override a no-op that still looked correct when invoked directly.
  record: ServerRouting | null;
  readonly webSocket: ServerSocketConstructor;
  server: NonNullable<ServerOptions["server"]> | null;
  lifecycle: ServerLifecycle;
  shouldEmitClose: boolean;
  removeListeners: (() => void) | null;
};

export type ServerRegistry = Registry<ServerEventMap>;
