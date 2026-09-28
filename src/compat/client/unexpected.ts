/// A response that was not a 101 and not a redirect: the caller's to handle, because only the
/// application knows whether a 401 with a challenge, a 403 from a proxy, and a 200 from
/// something that is not a WebSocket server are three problems or one. `ws` only aborts when
/// nothing is listening; aborting unconditionally made `unexpected-response` a teardown notice.

import type { ClientRequest, IncomingMessage } from "node:http";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { abort } from "./dial";
import type { Attempt } from "./connect";

/// Fails unless a listener took the response.
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
