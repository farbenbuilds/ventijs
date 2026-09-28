/// A response that was neither a 101 nor an upgrade: a redirect, or nothing like either.
///
/// Split out of `open.ts` because a non-101 is not a variant of a 101. It has no
/// `Sec-WebSocket-Accept`, there is no socket to hand to the codec, and the caller is
/// the one who decides what happens next -- which is why both events carry a
/// `ClientRequest`.
///
/// **The refusal is the caller's to make.** `ws` only aborts when nothing is listening,
/// and a listener that wants to read a 401's `www-authenticate` before deciding has been
/// given the response and the request for exactly that. Aborting unconditionally made
/// `unexpected-response` observable only as a notification of a teardown.

import type { ClientRequest, IncomingMessage } from "node:http";
import { listenerCount as listenerCountOf } from "../events/registry";
import { emitEvent } from "../events/emitter";
import { reportUnexpected } from "./unexpected";
import { createError } from "../errors";
import { parseAddress, type ClientAddress } from "./address";
import { abort, create, finish } from "./dial";
import { buildRequest, newKey } from "./request";
import { stripCredentials } from "./credentials";
import type { Attempt } from "./connect";

/// Whether a response is a redirect this client is willing to follow.
///
/// A `Location` with any other status is not a redirect: a 200 carrying one is a server
/// that meant something else by the header, and following it would connect to a place the
/// peer never pointed at.
export function isRedirect(status: number, location: string | undefined): boolean {
  return location !== undefined && status >= 300 && status < 400;
}

/// The answer to a non-101 response: a hop to make, a hand-back, or a refusal.
export function onResponse(
  attempt: Attempt,
  request: ClientRequest,
  response: IncomingMessage,
): void {
  const location = response.headers.location;
  if (isRedirect(response.statusCode ?? 0, location) && attempt.options.followRedirects) {
    follow(attempt, request, response, location ?? "");
    return;
  }
  reportUnexpected(attempt, request, response);
}

/// Follows one hop, or refuses the chain.
///
/// The four refusals are stated in the module doc. Each of them ends the chain, and each
/// reports before it does, so a caller learns which one happened rather than only that
/// something did.
function follow(
  attempt: Attempt,
  request: ClientRequest,
  response: IncomingMessage,
  location: string,
): void {
  if (attempt.redirects + 1 > attempt.options.maxRedirects) {
    request.abort();
    abort(attempt, createError("ERR_PROTOCOL", "Maximum redirects exceeded"));
    return;
  }
  const target = resolve(location, attempt.state.url);
  let next: ClientAddress;
  try {
    next = parseAddress(target);
  } catch (error) {
    request.abort();
    abort(
      attempt,
      createError(
        "ERR_PROTOCOL",
        error instanceof Error ? error.message : `Invalid URL: ${target}`,
      ),
    );
    return;
  }
  if (attempt.address.secure && !next.secure) {
    request.abort();
    abort(attempt, createError("ERR_PROTOCOL", "Cannot follow a redirect from wss: to ws:"));
    return;
  }
  if (next.authority !== attempt.address.authority && listenerCount(attempt) === 0) {
    // A different host must not see the credentials this one was given, and the URL a
    // redirect names carries none, so both the header and the carried value go. This is
    // curl 7.77's rule and a security property rather than a preference. A `redirect`
    // listener suspends it, because the event exists so a caller can inspect and remove
    // headers per hop and it cannot do that from a set it cannot see.
    stripCredentials(attempt.handshake.request.headers);
    attempt.auth = undefined;
  }
  request.abort();
  attempt.state.url = next.url;
  attempt.address = next;
  attempt.redirects += 1;
  // Rebuilt for the hop, not reused: a fresh key is a fresh handshake, and the request
  // target is the redirect's, not the one the socket was opened with. Reusing the first
  // hop's request sent the second request to the first hop's path, which is a redirect
  // that loops back to itself and looks like an infinite chain until `maxRedirects`.
  attempt.handshake = buildRequest(
    next,
    attempt.options,
    attempt.requested,
    newKey(),
    attempt.auth,
  );
  const hop = create(attempt);
  if (hop === null) return;
  // Before the hop goes out, which is the only order in which a listener can still
  // change it: `ws` creates the request, emits, and then ends it.
  emitEvent(attempt.state, "redirect", next.url, hop);
  finish(attempt, hop);
}

/// Resolves a `Location` against the address it came from, which is what a relative
/// redirect means and what a caller would otherwise have to do by hand.
function resolve(location: string, base: string): string {
  try {
    return new URL(location, base).href;
  } catch {
    return location;
  }
}

function listenerCount(attempt: Attempt): number {
  return listenerCountOf(attempt.state.listeners, "redirect");
}
