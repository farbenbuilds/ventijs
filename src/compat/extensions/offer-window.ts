/// Whether a client offer allows the 15-bit window this compressor emits, and whether the
/// server's own configured window is one it can produce. The offer comparison is `ws`'s at
/// `permessage-deflate.js:166`; a below-15 option is declined because one-shot libdeflate
/// emits only 15, so answering it would name a window the stream never uses.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import { WINDOW_BITS, type Normalized } from "./params";

export function serverWindowUsable(
  options: NormalizedPerMessageDeflate,
  offer: Normalized,
): boolean {
  const wanted = options.serverMaxWindowBits;
  // A window below 15 is one no offer can grant: declining every offer beats answering with
  // a parameter this compressor cannot honour.
  if (typeof wanted === "number" && wanted < WINDOW_BITS) return false;
  const asked = offer.server_max_window_bits;
  if (asked === undefined) return true;
  if (wanted === false) return false;
  if (typeof wanted === "number") {
    if (wanted > asked) return false;
    return wanted >= WINDOW_BITS;
  }
  return asked >= WINDOW_BITS;
}
