//! A response that was not a 101 and not a redirect: the caller's to handle.
//!
//! Split out of `redirect.ts` because the two are opposites. A redirect is an answer
//! this client acts on; anything else is an answer it hands over, because only the
//! application knows whether a 401 with a challenge, a 403 from a proxy, and a 200 from
//! something that is not a WebSocket server are three problems or one.
//!
//! **The refusal is the caller's to make.** `ws` only aborts when nothing is listening,
//! and a listener that wants to read a 401's `www-authenticate` before deciding has been
//! given the response and the request for exactly that. Aborting unconditionally made
//! `unexpected-response` observable only as a notification of a teardown.

import type { ClientRequest, IncomingMessage } from "node:http";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { abort } from "./dial";
import type { Attempt } from "./connect";

/// Emits the event for a response that was neither a 101 nor a redirect, and fails
/// unless the caller took it.
export function reportUnexpected(
  attempt: Attempt,
  request: ClientRequest,
  response: IncomingMessage,
): void {
  const taken = emitEvent(attempt.state, "unexpected-response", request, response);
  if (taken) return;
  request.abort();
  abort(
    attempt,
    createError("ERR_PROTOCOL", `Unexpected server response: ${response.statusCode ?? 0}`),
  );
}
