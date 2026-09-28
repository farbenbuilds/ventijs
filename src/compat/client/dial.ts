/// Issuing the opening request, and the three answers it can get. `http.request` rather
/// than a socket and a hand-written request line: the response parser, the redirect
/// statuses and the header casing would all be ours to get right, and `upgrade`,
/// `redirect` and `unexpected-response` are `ClientRequest` events, so there has to be a
/// `ClientRequest` to hand a listener.

import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { failConnection } from "../socket/lifecycle";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { onUpgrade } from "./open";
import { onResponse } from "./redirect";
import type { Attempt } from "./connect";
import type { Handshake } from "./request";
import type { WebSocket } from "../../types/ws";

/// Sends the request and wires the three answers. A redirect re-enters here, so a chain of
/// redirects is several dials on one socket.
export function dial(attempt: Attempt): ClientRequest | null {
  const request = create(attempt);
  if (request === null) return null;
  finish(attempt, request);
  return request;
}

/// Ends the request, or hands it to `finishRequest`. Always calling `end()` would leave the
/// option inert: a last-moment header would be dropped without an error.
export function finish(attempt: Attempt, request: ClientRequest): void {
  const callback = attempt.options.finishRequest;
  if (callback === undefined) {
    request.end();
    return;
  }
  // Checked because `ws` passes it and a missing target crashes the callback.
  const target = attempt.state.target as WebSocket | undefined;
  if (target === undefined) {
    request.end();
    return;
  }
  callback(request, target);
}

/// Creates and wires a hop's request unsent, since `redirect` carries the next hop's.
export function create(attempt: Attempt): ClientRequest | null {
  const { options, handshake } = attempt;
  // Dialling a socket that closed mid-handshake opens a connection nothing reads it.
  if (attempt.state.readyState === CLOSED) return null;

  const request = issue(attempt, handshake.request);
  attempt.request = request;
  // How `close()`/`terminate()` reach a request that has no socket yet.
  attempt.state.cancelHandshake = () => {
    request.abort();
  };
  // `ws` guards this by clearing `_req`; the identity check is the equivalent.
  request.on("error", (error: Error) => {
    if (attempt.request !== request) return;
    attempt.request = null;
    failConnection(attempt.state, error);
  });
  // Truthiness, as `ws` gates it (`websocket.js:888`): zero says "no deadline", and a zero
  // timer would fire on the next tick and refuse a handshake nobody put one on. Re-armed
  // per hop, because the deadline is per handshake.
  if (options.handshakeTimeout) {
    request.setTimeout(options.handshakeTimeout, () => {
      refuse(attempt, request, "Opening handshake has timed out");
    });
  }
  request.on("upgrade", (response, socket, head) => {
    if (attempt.request !== request) return;
    attempt.request = null;
    onUpgrade(attempt, response, socket, head);
  });
  request.on("response", (response) => {
    if (attempt.request !== request) return;
    attempt.request = null;
    onResponse(attempt, request, response);
  });
  return request;
}

/// The one place a request module is chosen, so the whole TLS decision lives here.
function issue(attempt: Attempt, options: Handshake["request"]): ClientRequest {
  return attempt.address.secure ? httpsRequest(options) : httpRequest(options);
}

/// `abort()` not `destroy()`, as `ws` calls: it stops Node writing a queued body.
export function refuse(attempt: Attempt, request: ClientRequest | null, message: string): void {
  request?.abort();
  abort(attempt, createError("ERR_PROTOCOL", message));
}

/// The `CLOSED` latch is `failConnection`'s, because `finishConnection` returns early on an
/// already-`CLOSED` socket and latching here would swallow the `close` event.
export function abort(attempt: Attempt, error: Error): void {
  const { state } = attempt;
  if (state.readyState === CLOSED) return;
  state.cancelHandshake = null;
  attempt.request?.destroy();
  attempt.request = null;
  if (attempt.transport !== null) discard(attempt.transport);
  failConnection(state, error);
}

/// A `CONNECTING` socket holds no connection, so `bufferedAmount` has nothing to account.
export type PendingTransport = Socket | null;

export type { ClientRequest, IncomingMessage };

/// A read in flight still reports its error on the next tick, so the listener goes on
/// first or it reaches the caller's process uncaught.
export function discard(socket: Socket): void {
  socket.on("error", () => undefined);
  socket.destroy();
}
