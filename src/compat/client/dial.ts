/// Issuing the opening request, and the three answers it can get.
///
/// Split out of `connect.ts` because `connect.ts` owns the socket's lifetime and this
/// owns the request's. The split is what makes the payload events possible: `upgrade`,
/// `redirect`, and `unexpected-response` are `http.ClientRequest` events, and handing a
/// caller the URL and a status instead of the request object is the gap those three
/// names describe.
///
/// **`http.request` rather than a socket and some bytes.** The previous route dialled
/// with `net` or `tls`, wrote a request line by hand, and read the response back off the
/// socket. It worked, and it made three `ws` events impossible: there was no request
/// object to hand a caller, no `Location` handling on a hop the client had to
/// re-issue itself, and no `ClientRequest` for a listener to `destroy()`. Node already
/// implements the parser, the redirect statuses, and the header casing; using it is
/// both less code and closer to `ws`.

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

/// Sends the request and wires the three answers.
///
/// Exported because a redirect replaces the request and re-enters here: one dial is the
/// unit of work, and a chain of redirects is several dials against one socket.
export function dial(attempt: Attempt): ClientRequest | null {
  const request = create(attempt);
  if (request === null) return null;
  request.end();
  return request;
}

/// Creates and wires a hop's request without sending it.
///
/// Split from `dial` because `ws` emits `redirect` with the *next* hop's request, after
/// creating it and before ending it. A caller that is handed a request which has already
/// been sent cannot set a header on it, and setting a header on a hop is the only reason
/// the event carries one.
export function create(attempt: Attempt): ClientRequest | null {
  const { options, handshake } = attempt;
  // A caller that closed or terminated the socket while the handshake was in flight has
  // already been told the socket is gone. Dialling now would open a connection nothing
  // will ever read, and its `upgrade` would arrive on a socket that is already `CLOSED`.
  if (attempt.state.readyState === CLOSED) return null;

  const request = issue(attempt, handshake.request);
  attempt.request = request;
  // How `close()` and `terminate()` reach a request that has no socket yet.
  attempt.state.cancelHandshake = () => {
    request.abort();
  };
  // A request that has no `error` listener throws, so this is attached before anything
  // that can fail. `ws` guards the same listener with a null check because it clears
  // `_req` on a completed handshake; the flag here is the equivalent.
  request.on("error", (error: Error) => {
    if (attempt.request !== request) return;
    attempt.request = null;
    failConnection(attempt.state, error);
  });
  if (options.handshakeTimeout !== undefined) {
    // Re-armed for every hop, because each dial is a fresh handshake and a caller who set
    // a deadline meant it per handshake rather than for the whole chain.
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
/// `req.abort()` rather than `req.destroy()` because that is what `ws` calls, and
/// because `abort()` is the one that stops Node from writing a body it has already
/// queued: a 3xx with a body would otherwise leave a response in a peer's buffer.
export function refuse(attempt: Attempt, request: ClientRequest | null, message: string): void {
  request?.abort();
  abort(attempt, createError("ERR_PROTOCOL", message));
}

/// Refuses a connection, as `ws` does: `error`, then `close`.
///
/// The code is 1006 because no close frame was exchanged; a peer learns nothing from us,
/// which is precisely what 1006 describes.
///
/// This delegates the latch to `failConnection`, which is `ws`'s `emitErrorAndClose`
/// exactly. Latching `CLOSED` here before dispatching was self-defeating:
/// `finishConnection` is the only path to `CLOSED` and it returns immediately on a
/// socket that is already there, so every one of these refusals set the state and then
/// skipped the event. A caller waiting on `close` to learn the handshake failed -- which
/// is the usual shape, since a rejected handshake is only ever observable through the two
/// events -- hung for the life of the process, and the tests missed it because they
/// asserted `readyState`, which was 3.
export function abort(attempt: Attempt, error: Error): void {
  const { state } = attempt;
  if (state.readyState === CLOSED) return;
  state.cancelHandshake = null;
  attempt.request?.destroy();
  attempt.request = null;
  if (attempt.transport !== null) discard(attempt.transport);
  failConnection(state, error);
}

/// The duplex stream a request will hand over on a 101, or null before then.
///
/// The codec has nothing to read until the upgrade lands, and the previous route's
/// `net.Socket` was open from the first dial -- so a `CONNECTING` socket held a real
/// connection and `bufferedAmount` accounted bytes against a queue nothing drained.
export type PendingTransport = Socket | null;

/// Re-exported so the response handler and the upgrade handler agree on what a response
/// is, without either importing the other's module for it.
export type { ClientRequest, IncomingMessage };

/// Destroys a socket, making the destroy safe to await.
///
/// A socket that is destroyed while a read is in flight still reports that read's error,
/// asynchronously and on the next tick. Without a listener on it that error is an
/// uncaught exception in the caller's process, attributed to whichever test or request
/// happened to be running -- which is exactly what destroying a socket from inside an
/// event handler does. The listener is attached before the destroy, so there is no window
/// in which the error can arrive first.
export function discard(socket: Socket): void {
  socket.on("error", () => undefined);
  socket.destroy();
}
