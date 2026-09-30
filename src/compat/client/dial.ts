/// Issuing the opening request. `http.request` rather than a hand-written request line,
/// because the response parser, the redirect statuses and the header casing would be ours
/// to get right, and `upgrade`, `redirect` and `unexpected-response` are its events.

import type { ClientRequest } from "node:http";
import { onUpgrade } from "./open";
import { onResponse } from "./redirect";
import { create, finish } from "./hop";
import type { Attempt } from "./connect";

/// Sends the request and wires the three answers. A redirect re-enters here, so a chain of
/// redirects is several dials on one socket.
export function dial(attempt: Attempt): ClientRequest | null {
  // Wired here, not in `hop.ts`: importing these there restores the cycle this split removed.
  const request = create(attempt, { upgrade: onUpgrade, response: onResponse });
  if (request === null) return null;
  finish(attempt, request);
  return request;
}
