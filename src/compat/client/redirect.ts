import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { parseAddress, type ClientAddress } from "./address";
import { abort, type Attempt } from "./connect";

/// Whether a response is a redirect this client is willing to follow.
///
/// A `Location` with any other status is not a redirect: a 200 carrying one is a
/// server that meant something else by the header, and following it would connect to
/// a place the peer never pointed at.
export function isRedirect(status: number, location: string | undefined): boolean {
  return location !== undefined && status >= 300 && status < 400;
}

/// Decides what a redirect does, and reports the rest.
///
/// Three things are refused, each for a reason a caller can act on:
///
/// - Without `followRedirects` the `redirect` event fires and the socket fails, which
///   is what the option means: the caller is told where it would have been sent.
/// - Past `maxRedirects` it fails, because a redirect loop between two servers would
///   otherwise dial forever.
/// - A `wss:` to `ws:` downgrade is refused, because following it would send the
///   handshake in the clear to whatever the redirect named.
///
/// Credentials are dropped when the redirect leaves the original host, which is curl
/// 7.77's rule and a security property rather than a preference: a redirect to another
/// host must not carry the credentials the first host was given.
export function decide(
  attempt: Attempt,
  location: string,
  original: ClientAddress,
): ClientAddress | null {
  const target = resolve(location, attempt.state.url);
  if (!attempt.options.followRedirects) {
    // Reported and then refused: `ws` emits `redirect` for a 3xx the client will not
    // follow, and if the caller does not take over the connection the handshake is
    // aborted with the status it was refused with. Returning without either would
    // leave the socket `CONNECTING` for the life of the process, holding a transport
    // that will never be written to.
    emitEvent(attempt.state, "redirect", target);
    reportUnexpected(attempt, 302);
    return null;
  }
  if (attempt.redirects + 1 > attempt.options.maxRedirects) {
    fail(attempt, "Maximum redirects exceeded");
    return null;
  }
  let next: ClientAddress;
  try {
    next = parseAddress(target);
  } catch (error) {
    // A `Location` that is not a URL is the redirect's problem, not the caller's, so it
    // is reported through the socket rather than thrown out of a callback.
    fail(attempt, error instanceof Error ? error.message : `Invalid URL: ${target}`);
    return null;
  }
  if (original.secure && !next.secure) {
    fail(attempt, "Cannot follow a redirect from wss: to ws:");
    return null;
  }
  if (next.authority !== original.authority) {
    // A different host must not see the credentials this one was given, and the URL a
    // redirect names carries none, so both the header and the carried value go.
    stripCredentials(attempt);
    attempt.auth = undefined;
  }
  attempt.state.url = next.url;
  return next;
}

/// Emits the event for a response that was neither a 101 nor a redirect, and fails.
///
/// `ws` hands the caller the `ClientRequest` and the `IncomingMessage` so it can
/// decide. This client owns the socket rather than an `http.ClientRequest`, so there is
/// no request object to hand over; what a caller needs in order to decide is the URL
/// it dialled and the status it was refused with, and closing the socket is how it
/// stops. The difference is recorded in `docs/compliance-api.md`.
export function reportUnexpected(attempt: Attempt, status: number): void {
  emitEvent(attempt.state, "unexpected-response", attempt.state.url, status);
  abort(attempt, createError("ERR_PROTOCOL", `Unexpected server response: ${status}`));
}

/// Fails an attempt whose socket is already gone, which a redirect can race with.
export function alreadyClosed(attempt: Attempt): boolean {
  return attempt.state.readyState === CLOSED;
}

function fail(attempt: Attempt, message: string): void {
  abort(attempt, createError("ERR_PROTOCOL", message));
}

/// Removes the caller's credentials when a redirect leaves the original host.
function stripCredentials(attempt: Attempt): void {
  const headers = { ...attempt.handshake.headers };
  for (const name of ["Authorization", "authorization", "Cookie", "cookie"]) {
    delete headers[name];
  }
  attempt.handshake = { ...attempt.handshake, headers };
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
