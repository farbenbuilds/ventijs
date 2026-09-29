/// Whether an offer is one this server cannot answer. The window rules are `ws`'s at
/// `permessage-deflate.js:160-172`, with the compressor's own limit in `window.ts`.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { Normalized } from "./params";
import { serverWindowUsable } from "./offer-window";

export function declines(options: NormalizedPerMessageDeflate, offer: Normalized): boolean {
  if (options.serverNoContextTakeover === false && offer.server_no_context_takeover) return true;
  if (offer.server_max_window_bits !== undefined && !serverWindowUsable(options, offer)) {
    return true;
  }
  // A valueless `client_max_window_bits` is the client saying "choose", and `false` is this
  // server declining to, so the offer is refused rather than answered.
  if (offer.client_max_window_bits === true && options.clientMaxWindowBits === false) return true;
  // RFC 7692 section 7.1.2.1 requires a value in a server response, so a client that named no
  // window cannot be answered with one, and this server cannot give more than it asked for.
  if (typeof options.clientMaxWindowBits === "number") {
    if (offer.client_max_window_bits === undefined) return true;
    const asked = offer.client_max_window_bits;
    if (typeof asked === "number" && options.clientMaxWindowBits > asked) return true;
  }
  return false;
}
