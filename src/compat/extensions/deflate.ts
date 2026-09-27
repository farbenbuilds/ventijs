/// Negotiating `permessage-deflate`, in both directions.
///
/// Split out of the server handshake and the client open because negotiation is one
/// decision with two entry points, and the two are the same decision read in opposite
/// directions: the server picks from a client's offers, the client checks a server's
/// answer against what it offered.
///
/// **The negotiation is `ws`'s, exactly.** The rules below are `ws`'s
/// `acceptAsServer` and `acceptAsClient` with one substitution, and the substitution is
/// the whole reason this is a separate module rather than a copy: `ws` can honour a
/// `*_max_window_bits` below 15 because its compressor is a streaming zlib, and this
/// codec's is a one-shot libdeflate that always emits a full window. So a window smaller
/// than 15 is declined rather than accepted-and-ignored. Everything else -- the two
/// `no_context_takeover` parameters, the shape of the answer, the order the parameters
/// are written in, which errors are raised where -- is unchanged, because a header a
/// `ws` peer can read is the whole point.
///
/// **No context takeover, in both directions, always.** RFC 7692 section 7.1.1.1 lets
/// either end answer with `server_no_context_takeover` or `client_no_context_takeover`,
/// and `ws` accepts both unconditionally. Carrying a deflate window across messages
/// needs a streaming codec; this is not one, and a one-shot codec that pretended to
/// would corrupt the second message. Declining is always legal and costs compression
/// ratio rather than correctness, which is why the answer is the same two parameters
/// the pinned engine's own WebSocket route writes.

import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { ParsedExtension } from "./grammar";
import { formatExtension } from "./format";
import { NO_CONTEXT_TAKEOVER, PERMESSAGE_DEFLATE } from "./negotiated";
import { narrowed } from "./window";
import { declines } from "./decline";
import { normalizeParameters, WINDOW_BITS, type Normalized } from "./params";

/// The window this codec's compressor always emits, and therefore the only one it can
/// honour. A peer that asks for less cannot be given it, and a peer that is told less
/// will inflate with a smaller window and fail on a back-reference.

export type AcceptedDeflate = {
  /// The extension name, which is only ever `permessage-deflate`.
  readonly name: string;
  /// The parameters to write in the response, in the order `ws` writes them.
  readonly parameters: Readonly<Record<string, string>>;
  /// The value for the `Sec-WebSocket-Extensions` response header.
  readonly header: string;
};

/// Picks one of a client's offers, or refuses every one of them.
///
/// Returns the refusal reason rather than throwing, because the server has two
/// destinations for it -- a 400 written to the socket, or a `wsClientError` event --
/// and the caller chooses. `ws` throws and the caller catches; the decision is the
/// same and putting it here keeps the two callers from each re-deriving it.
export type DeflateNegotiation =
  | { readonly accepted: AcceptedDeflate }
  | { readonly refusal: string };

/// What a server answers.
///
/// A refusal is `null` rather than a `DeflateNegotiation`, because a client that simply
/// did not offer the extension is not an error: RFC 7692 lets either end ignore an
/// extension, and `ws` connects uncompressed in that case. Only a client that offered it
/// and made the offer unusable is a 400.
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

/// What a client does with a server's answer.
///
/// Null means the extension was not negotiated, which is not a failure: a server is
/// free not to answer. A string is the refusal, and the caller aborts the handshake with
/// it, which is what `ws` does and what the message text matches.
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
  // section 7.1.2.1 does not allow. `acceptAsServer` never emits one, so this only
  // fires against a peer that is not following the specification.
  if (asked === true) return { refusal: 'Value must be specified for "client_max_window_bits"' };
  const wanted = options.clientMaxWindowBits;
  if (wanted === false) {
    return { refusal: 'Unexpected or invalid parameter "client_max_window_bits"' };
  }
  if (typeof wanted === "number" && asked > wanted) {
    return { refusal: 'Unexpected or invalid parameter "client_max_window_bits"' };
  }
  if (typeof asked === "number" && asked < WINDOW_BITS) {
    // A server that answered with a window this codec cannot honour. It is a refusal
    // rather than a silent acceptance, because a compressor that used a wider window
    // would produce a stream this peer's inflater rejects mid-message.
    return { refusal: "Server requested a window this implementation cannot use" };
  }
  return { accepted: answer(options, normalized) };
}

/// The response header, which is this codec's own two parameters and nothing else.
///
/// It is deliberately not a subset of the offer. RFC 7692 section 7.1.2.2 lets a server
/// answer with parameters the client did not offer, and `ws` accepts both
/// `no_context_takeover` parameters without checking, so a header a `ws` client reads
/// and understands is one that states what this side will actually do.
function answer(options: NormalizedPerMessageDeflate, offer: Normalized): AcceptedDeflate {
  const parameters: Record<string, string> = { ...NO_CONTEXT_TAKEOVER };
  if (offer.server_no_context_takeover) parameters.server_no_context_takeover = "";
  narrowed(parameters, "server_max_window_bits", options.serverMaxWindowBits);
  narrowed(parameters, "client_max_window_bits", options.clientMaxWindowBits);
  return {
    name: PERMESSAGE_DEFLATE,
    parameters,
    header: formatExtension(PERMESSAGE_DEFLATE, parameters),
  };
}
