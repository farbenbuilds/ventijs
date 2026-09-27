//! Whether an offer is one this server cannot answer.
//!
//! Split out of `deflate.zig` because this is the one half of a server's decision that is
//! a predicate over two values rather than a single rule, and a predicate is exactly the
//! thing that has to be readable without scrolling past three other functions to see what
//! it returns.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import { WINDOW_BITS, type Normalized } from "./params";

/// Whether a server cannot accept an offer it would otherwise take.
export function declines(options: NormalizedPerMessageDeflate, offer: Normalized): boolean {
  if (options.serverNoContextTakeover === false && offer.server_no_context_takeover) return true;
  if (offer.server_max_window_bits !== undefined) return true;
  if (
    typeof offer.client_max_window_bits === "number" &&
    offer.client_max_window_bits < WINDOW_BITS
  ) {
    return true;
  }
  // A client that named no window will not accept a server that names one, and
  // `ws` refuses to answer one that did. The valueless form is the opposite: it is a
  // client asking to be given one, which is why only `undefined` is tested here.
  if (
    typeof options.clientMaxWindowBits === "number" &&
    offer.client_max_window_bits === undefined
  ) {
    return true;
  }
  return false;
}
