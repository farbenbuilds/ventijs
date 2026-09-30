/// `permessage-deflate` both ways under `ws`'s rules, one deliberate divergence: a below-15
/// `*_max_window_bits` is declined, because one-shot libdeflate emits only a full window.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { ParsedExtension } from "./grammar";
import { formatExtension } from "./format";
import { NO_CONTEXT_TAKEOVER, PERMESSAGE_DEFLATE } from "./negotiated";
import { declines } from "./decline";
import { normalizeParameters, WINDOW_BITS, type Normalized } from "./params";

export type AcceptedDeflate = {
  readonly name: string;
  /// In the order `ws` writes them, which is what a `ws` peer's tests compare against.
  readonly parameters: Readonly<Record<string, string>>;
  readonly header: string;
};

/// Picks one of a client's offers, or refuses every one of them. A refusal is returned
/// rather than thrown: a 400 on the socket and a `wsClientError` event are its two
/// destinations and the caller picks.
export type DeflateNegotiation =
  | { readonly accepted: AcceptedDeflate }
  | { readonly refusal: string };

/// What a server answers. `null` is not an error: RFC 7692 lets either end ignore an
/// extension. Only an offer that was made and turned out unusable is a 400.
export function acceptAsServer(
  offers: readonly ParsedExtension[],
  options: NormalizedPerMessageDeflate | false,
): DeflateNegotiation | null {
  if (options === false) return null;
  if (offers.length === 0) return null;

  for (const offer of offers) {
    const normalized = normalizeParameters(offer.parameters, true);
    if (normalized === null) {
      return { refusal: "Invalid or unacceptable Sec-WebSocket-Extensions header" };
    }
    if (declines(options, normalized)) continue;
    return { accepted: answer(options, normalized) };
  }
  return { refusal: "Invalid or unacceptable Sec-WebSocket-Extensions header" };
}

/// `null` means the extension was not negotiated, not a failure; a string is the
/// refusal, and the caller aborts the handshake with it, as `ws` does.
export function acceptAsClient(
  response: ParsedExtension,
  options: NormalizedPerMessageDeflate | false,
): { readonly accepted: AcceptedDeflate } | { readonly refusal: string } | null {
  if (options === false) return null;
  const normalized = normalizeParameters(response.parameters, false);
  if (normalized === null) {
    return { refusal: "Invalid Sec-WebSocket-Extensions header" };
  }
  if (normalized.client_no_context_takeover && options.clientNoContextTakeover === false) {
    return { refusal: 'Unexpected parameter "client_no_context_takeover"' };
  }
  const asked = normalized.client_max_window_bits;
  if (asked === undefined) return { accepted: answer(options, normalized) };
  // A valueless form here is a server that declined to choose, which RFC 7692
  // section 7.1.2.1 forbids. `acceptAsServer` never emits one, so this only fires
  // against a non-conforming peer.
  if (asked === true) return { refusal: 'Value must be specified for "client_max_window_bits"' };
  const wanted = options.clientMaxWindowBits;
  if (wanted === false) {
    return { refusal: 'Unexpected or invalid parameter "client_max_window_bits"' };
  }
  if (typeof wanted === "number" && asked > wanted) {
    return { refusal: 'Unexpected or invalid parameter "client_max_window_bits"' };
  }
  if (typeof asked === "number" && asked < WINDOW_BITS) {
    // Refused, not silently accepted: a wider window would emit a stream the peer's
    // inflater rejects mid-message.
    return { refusal: "Server requested a window this implementation cannot use" };
  }
  return { accepted: answer(options, normalized) };
}

/// 15 is the only window libdeflate emits, so only a client window below it is written.
function narrowClientWindow(
  parameters: Record<string, string>,
  option: number | false | undefined,
): void {
  if (typeof option !== "number" || option >= WINDOW_BITS) return;
  parameters.client_max_window_bits = String(option);
}

/// This codec's own two parameters and nothing else, deliberately not a subset of the
/// offer: RFC 7692 section 7.1.2.2 lets a server answer with unoffered parameters and
/// `ws` accepts both `no_context_takeover` ones unasked, so the header states what this
/// side will do. Context takeover is always declined: a one-shot codec carrying a window
/// would corrupt the second message.
function answer(options: NormalizedPerMessageDeflate, offer: Normalized): AcceptedDeflate {
  const parameters: Record<string, string> = { ...NO_CONTEXT_TAKEOVER };
  if (offer.server_no_context_takeover) parameters.server_no_context_takeover = "";
  // The server window is never written: 15 is all this compressor emits, and a below-15
  // option is declined by `serverWindowUsable` before an answer is built.
  narrowClientWindow(parameters, options.clientMaxWindowBits);
  return {
    name: PERMESSAGE_DEFLATE,
    parameters,
    header: formatExtension(PERMESSAGE_DEFLATE, parameters),
  };
}
