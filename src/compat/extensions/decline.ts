/// Whether an offer is one this server cannot answer. The window rules are `ws`'s at
/// `permessage-deflate.js:160-172`, with the compressor's own limit in `offer-window.ts`.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { Normalized } from "./params";
import { serverWindowUsable } from "./offer-window";

export function declines(options: NormalizedPerMessageDeflate, offer: Normalized): boolean {
  if (options.serverNoContextTakeover === false && offer.server_no_context_takeover) return true;
  // Unconditional: the option alone can make the window unusable, with no offer window to
  // blame, which is the option-only path a `serverMaxWindowBits` below 15 arrives on.
  if (!serverWindowUsable(options, offer)) return true;
  // A valueless `client_max_window_bits` is "choose", and `false` is this server declining.
  if (offer.client_max_window_bits === true && options.clientMaxWindowBits === false) return true;
  // RFC 7692 section 7.1.2.1 requires a value here, and this side cannot give more than asked.
  if (typeof options.clientMaxWindowBits === "number") {
    if (offer.client_max_window_bits === undefined) return true;
    const asked = offer.client_max_window_bits;
    if (typeof asked === "number" && options.clientMaxWindowBits > asked) return true;
  }
  return false;
}
