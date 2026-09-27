import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerState } from "../../types/server";
import type { VerifyClientCallbackAsync, VerifyClientCallbackSync } from "../../types/ws";
import {
  abortHandshake,
  abortOrEmit,
  isSecure,
  KEY_PATTERN,
  parseProtocols,
  requestHeader,
} from "./handshake";
import { completeUpgrade, type UpgradeCallback } from "./accept";
import { attachHandshakeError } from "./handshake-error";

/// The `info` record a `verifyClient` hook receives. Its runtime `origin` can
/// be undefined even though the vendored type declares `string`.
type VerifyClientRequest = Parameters<VerifyClientCallbackSync>[0];

/// The built-in routing rule: a server with no `path` accepts everything, and a
/// server with one matches it against the request path without its query.
export function defaultShouldHandle(state: ServerState, request: IncomingMessage): boolean {
  const path = state.options.path;
  if (!path) return true;
  const url = request.url ?? "";
  const index = url.indexOf("?");
  return (index !== -1 ? url.slice(0, index) : url) === path;
}

/// The routing decision, resolved through the server record's own method.
///
/// `ws` evaluates `this.shouldHandle(request)`, so a caller who reassigns
/// `server.shouldHandle` changes the decision. Calling a captured predicate, or
/// the module-level rule, made the documented override a no-op that still passed
/// any test which invoked the method directly.
export function shouldHandle(state: ServerState, request: IncomingMessage): boolean {
  const assigned = state.record?.shouldHandle;
  if (typeof assigned === "function") return assigned(request);
  return defaultShouldHandle(state, request);
}

/// Mirrors `WebSocketServer.handleUpgrade`: validate the handshake, apply
/// `verifyClient`, write the 101 response, and hand the accepted socket to the
/// caller. Validation failures route through the `wsClientError` policy.
export function handleUpgrade(
  state: ServerState,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  callback: UpgradeCallback,
): void {
  attachHandshakeError(socket);

  const key = request.headers["sec-websocket-key"];
  const upgrade = request.headers.upgrade;
  const version = Number(request.headers["sec-websocket-version"]);

  if (request.method !== "GET") {
    abortOrEmit(state, request, socket, 405, "Invalid HTTP method");
    return;
  }
  if (typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket") {
    abortOrEmit(state, request, socket, 400, "Invalid Upgrade header");
    return;
  }
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    abortOrEmit(state, request, socket, 400, "Missing or invalid Sec-WebSocket-Key header");
    return;
  }
  if (version !== 13 && version !== 8) {
    abortOrEmit(state, request, socket, 400, "Missing or invalid Sec-WebSocket-Version header", {
      "Sec-WebSocket-Version": "13, 8",
    });
    return;
  }
  if (!shouldHandle(state, request)) {
    abortHandshake(socket, 400);
    return;
  }

  const protocols = parseProtocols(state, request, socket);
  if (protocols === undefined) return;
  // Read the hook at upgrade time so a post-construction assignment on
  // `server.options` takes effect, matching `ws`.
  const verify = state.options.verifyClient ?? null;
  if (verify === null) {
    completeUpgrade(state, request, socket, head, key, protocols, callback);
    return;
  }
  // `ws` forwards the raw header, which can be undefined, even though its
  // types declare `origin: string`; the cast keeps that observable behavior.
  const info = {
    origin: requestHeader(request, version === 8 ? "sec-websocket-origin" : "origin"),
    secure: isSecure(request),
    req: request,
  } as unknown as VerifyClientRequest;
  if (verify.length === 2) {
    (verify as VerifyClientCallbackAsync)(info, (verified, code, message, headers) => {
      if (!verified) {
        abortHandshake(socket, code || 401, message, headers);
        return;
      }
      completeUpgrade(state, request, socket, head, key, protocols, callback);
    });
    return;
  }
  if (!(verify as VerifyClientCallbackSync)(info)) {
    abortHandshake(socket, 401);
    return;
  }
  completeUpgrade(state, request, socket, head, key, protocols, callback);
}
