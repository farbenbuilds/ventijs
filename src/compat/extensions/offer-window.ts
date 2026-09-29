/// Whether the window this compressor emits, 15, is the one a client offer allows.
///
/// The comparison against this side's own option is `ws`'s, at `permessage-deflate.js:166`: a
/// server that asked for more than the client offered has nothing to give back. What `ws` does
/// not do is decline a window it cannot produce. It accepts, answers, then compresses at 15
/// regardless, so the header claims a window the stream does not use.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import { WINDOW_BITS, type Normalized } from "./params";

export function serverWindowUsable(
  options: NormalizedPerMessageDeflate,
  offer: Normalized,
): boolean {
  const asked = offer.server_max_window_bits;
  if (asked === undefined) return true;
  if (options.serverMaxWindowBits === false) return false;
  if (typeof options.serverMaxWindowBits === "number") {
    if (options.serverMaxWindowBits > asked) return false;
    return options.serverMaxWindowBits >= WINDOW_BITS;
  }
  return asked >= WINDOW_BITS;
}
