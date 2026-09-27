import type { NormalizedServerOptions } from "../../types/options";
import type { ServerOptions } from "../../types/ws";
import {
  DEFAULT_MAX_PAYLOAD,
  closeTimeoutOf,
  invalidOption,
  normalizePerMessageDeflate,
} from "./shared";

export function normalizeServerOptions(options?: ServerOptions): NormalizedServerOptions {
  // ws copies own enumerable properties before reading, so inherited
  // properties are ignored and each getter runs exactly once.
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
    clientTracking: source.clientTracking ?? true,
    allowSynchronousEvents: source.allowSynchronousEvents ?? true,
    autoPong: source.autoPong ?? true,
    maxPayload: source.maxPayload ?? DEFAULT_MAX_PAYLOAD,
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
