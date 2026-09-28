import type { NormalizedServerOptions } from "../../types/options";
import type { ServerOptions } from "../../types/ws";
import { maxBufferedChunksOf, maxFragmentsOf, maxPayloadOf } from "./bounded";
import { codecLimits } from "../../binding/codec";
import { closeTimeoutOf, invalidOption, normalizePerMessageDeflate } from "./shared";

export function normalizeServerOptions(options?: ServerOptions): NormalizedServerOptions {
  // `ws` copies own enumerable properties before reading, so inherited properties are
  // ignored and each getter runs exactly once.
  const source = { ...options };
  const port = source.port ?? null;
  const server = source.server ?? null;
  const noServer = source.noServer ?? false;
  if (isAmbiguousListenTarget(port, server, noServer)) {
    invalidOption(
      'One and only one of the "port", "server", or "noServer" options must be specified',
    );
  }
  return {
    host: source.host ?? null,
    port,
    backlog: source.backlog ?? null,
    path: source.path ?? null,
    server,
    noServer,
    // Truthiness once the default is applied, as `ws` gates it. `?? true` read `null` as
    // absent and `0` and `""` as truthy, so every falsy value other than `false` left
    // tracking on and grew a `clients` set where `ws` has none.
    clientTracking: source.clientTracking === undefined ? true : Boolean(source.clientTracking),
    allowSynchronousEvents: source.allowSynchronousEvents ?? true,
    autoPong: source.autoPong ?? true,
    // Read against the addon's compiled ceilings, so an option above what the build
    // supports is refused here by name rather than becoming a native ordinal at the first
    // connection. The thunks are lazy, so `new WebSocketServer({ port })` loads no addon.
    maxPayload: maxPayloadOf(source, () => codecLimits().maxPayloadBytes),
    maxFragments: maxFragmentsOf(source, () => codecLimits().maxFragments),
    maxBufferedChunks: maxBufferedChunksOf(source),
    skipUTF8Validation: source.skipUTF8Validation ?? false,
    perMessageDeflate: normalizePerMessageDeflate(source.perMessageDeflate, false),
    closeTimeout: closeTimeoutOf(source),
    verifyClient: source.verifyClient ?? null,
    handleProtocols: source.handleProtocols ?? null,
    WebSocket: source.WebSocket,
  };
}

function isAmbiguousListenTarget(
  port: number | null,
  server: ServerOptions["server"] | null,
  noServer: boolean,
): boolean {
  const hasPort = port !== null;
  const hasServer = Boolean(server);
  if (hasPort && (hasServer || noServer)) return true;
  if (hasServer && noServer) return true;
  return !hasPort && !hasServer && !noServer;
}
