//! What a client asks for, which is this codec's own constraint rather than a preference.
//!
//! Split out of `deflate.ts` because the offer and the two answers are three different
//! decisions: an offer is only ever written, never read, and the two rules below are
//! about what this side can do rather than about what a peer said.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import { formatExtension } from "./format";
import { PERMESSAGE_DEFLATE, NO_CONTEXT_TAKEOVER } from "./negotiated";

/// The offer a client writes.
///
/// It states this codec's two `no_context_takeover` parameters rather than leaving the
/// extension bare, and that is not politeness. `ws` omits `Sec-WebSocket-Extensions`
/// entirely when the configuration it accepted has no parameters
/// (`websocket-server.js`, the `exts.length` check), so a bare offer from a client that
/// can only ever answer "no context takeover" is a request a `ws` server silently
/// declines: the extension is never negotiated and the connection runs uncompressed with
/// no error anywhere. Naming the parameters is what makes the offer answerable.
///
/// `client_max_window_bits` is deliberately absent, and that is a real cost of the
/// one-shot compressor. `ws` offers it bare by default, which asks a server to choose a
/// window; this codec cannot choose one below 15, so offering the parameter would invite
/// exactly the answer it would then have to refuse. A server that volunteers a window
/// anyway is handled by `acceptAsClient`.
export function offer(options: NormalizedPerMessageDeflate | false): string | undefined {
  if (options === false) return undefined;
  return formatExtension(PERMESSAGE_DEFLATE, NO_CONTEXT_TAKEOVER);
}
