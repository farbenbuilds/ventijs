/// Issuing the opening request, and the three answers it can get.
///
/// Split out of `connect.ts` because `connect.ts` owns the socket's lifetime and this
/// owns the request's. The split is what makes the payload events possible: `upgrade`,
/// `redirect`, and `unexpected-response` are `http.ClientRequest` events, and handing a
/// caller the URL and a status instead of the request object is the gap those three
/// names describe.
///
/// **`http.request` rather than a socket and some bytes.** A socket and a hand-written
/// request line would mean reimplementing the response parser, the redirect statuses and
/// the header casing, and there would be no `ClientRequest` for a listener to `destroy()`.
/// Node already has all three.

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

/// Sends the request and wires the three answers. Exported because a redirect replaces
/// the request and re-enters here: a chain of redirects is several dials, one socket.
export function dial(attempt: Attempt): ClientRequest | null {
  const request = create(attempt);
  if (request === null) return null;
  finish(attempt, request);
  return request;
}

/// Ends the request, or hands it to `finishRequest`.
///
/// `ws` lets the callback decide when the request goes out, and the default is
/// `request.end()`. Always calling `end()` made the option typed and inert, which is
/// worse than refusing it: a caller adding a last-moment header got no header and no
/// error.
export function finish(attempt: Attempt, request: ClientRequest): void {
  const callback = attempt.options.finishRequest;
  if (callback === undefined) {
    request.end();
    return;
  }
  // The record is assigned before the first dial, so it is set; the check is because
  // `ws` passes it and a missing one would be a crash inside the caller's own callback.
  const target = attempt.state.target as WebSocket | undefined;
  if (target === undefined) {
    request.end();
    return;
  }
  callback(request, target);
}

/// Creates and wires a hop's request without sending it, because `ws` emits `redirect`
/// with the *next* hop's request before that hop goes out, and a request already sent
/// cannot have a header set on it.
export function create(attempt: Attempt): ClientRequest | null {
  const { options, handshake } = attempt;
  // A socket closed while the handshake was in flight has been told it is gone; dialling
  // now would open a connection nothing reads, and its `upgrade` would arrive on a
  // `CLOSED` socket.
  if (attempt.state.readyState === CLOSED) return null;

  const request = issue(attempt, handshake.request);
  attempt.request = request;
  // How `close()` and `terminate()` reach a request that has no socket yet.
  attempt.state.cancelHandshake = () => {
    request.abort();
  };
  // A request with no `error` listener throws, so this goes on before anything that can
  // fail. `ws` guards the same listener because it clears `_req` on a completed
  // handshake; `attempt.request !== request` is the equivalent.
  request.on("error", (error: Error) => {
    if (attempt.request !== request) return;
    attempt.request = null;
    failConnection(attempt.state, error);
  });
  if (options.handshakeTimeout !== undefined) {
    // Re-armed per hop: each dial is a fresh handshake, and a caller who set a deadline
    // meant it per handshake rather than for the whole chain.
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

/// The one place a request module is chosen, which is the whole of the TLS decision.
function issue(attempt: Attempt, options: Handshake["request"]): ClientRequest {
  return attempt.address.secure ? httpsRequest(options) : httpRequest(options);
}

/// Refuses a handshake, destroying the request so the socket underneath it goes with it.
///
/// `abort()` rather than `destroy()` because that is what `ws` calls, and because it is
/// the one that stops Node writing a body it already queued.
export function refuse(attempt: Attempt, request: ClientRequest | null, message: string): void {
  request?.abort();
  abort(attempt, createError("ERR_PROTOCOL", message));
}

/// Refuses a connection, as `ws` does: `error`, then `close`. The code is 1006 because no
/// close frame was exchanged, which is what 1006 describes.
///
/// The latch is `failConnection`'s, which is `ws`'s `emitErrorAndClose`. Latching `CLOSED`
/// here first was self-defeating: `finishConnection` is the only path to `CLOSED` and
/// returns early on a socket already there, so every one of these refusals set the state
/// and skipped the event, and a caller waiting on `close` to learn the handshake failed
/// hung for the life of the process.
export function abort(attempt: Attempt, error: Error): void {
  const { state } = attempt;
  if (state.readyState === CLOSED) return;
  state.cancelHandshake = null;
  attempt.request?.destroy();
  attempt.request = null;
  if (attempt.transport !== null) discard(attempt.transport);
  failConnection(state, error);
}

/// The duplex stream a request will hand over on a 101, or null before then. There is no
/// socket before the upgrade, so a `CONNECTING` socket holds no connection and
/// `bufferedAmount` has nothing to account.
export type PendingTransport = Socket | null;

/// Re-exported so the response handler and the upgrade handler agree on what a response is.
export type { ClientRequest, IncomingMessage };

/// Destroys a socket, making the destroy safe to await.
///
/// A socket destroyed while a read is in flight still reports that read's error on the
/// next tick, and with no listener that is an uncaught exception in the caller's process.
/// The listener goes on first so there is no window in which it can arrive early.
export function discard(socket: Socket): void {
  socket.on("error", () => undefined);
  socket.destroy();
}
