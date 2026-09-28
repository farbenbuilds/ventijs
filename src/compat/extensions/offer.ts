/// What a client asks for, which is this codec's own constraint rather than a preference.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import { formatExtension } from "./format";
import { PERMESSAGE_DEFLATE, NO_CONTEXT_TAKEOVER } from "./negotiated";

/// It states this codec's two `no_context_takeover` parameters rather than leaving the
/// extension bare, which `ws` declines silently: it omits the header when the accepted
/// configuration has no parameters. `client_max_window_bits` is absent for the same reason:
/// `ws` offers it bare, and this one-shot compressor cannot choose a window below 15.
export function offer(options: NormalizedPerMessageDeflate | false): string | undefined {
  if (options === false) return undefined;
  return formatExtension(PERMESSAGE_DEFLATE, NO_CONTEXT_TAKEOVER);
}
