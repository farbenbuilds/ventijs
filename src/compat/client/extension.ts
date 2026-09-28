/// Reading a server's `permessage-deflate` answer. Both outcomes are checked before a
/// single frame is read, and neither is a socket transition.

import { acceptAsClient, type AcceptedDeflate } from "../extensions/deflate";
import { PERMESSAGE_DEFLATE } from "../extensions/negotiated";
import { parseExtensions, type ParsedExtension } from "../extensions/grammar";
import type { NormalizedPerMessageDeflate } from "../../types/options";
import type { IncomingMessage } from "node:http";

export type ClientExtension =
  | { readonly accepted: AcceptedDeflate | null }
  | { readonly refusal: string };

/// `accepted: null` is a server that did not answer, which is legal and is what an
/// uncompressed connection looks like. The refusals are the ones `ws` raises.
export function acceptExtension(
  response: IncomingMessage,
  options: NormalizedPerMessageDeflate | false,
): ClientExtension {
  const claimed = response.headers["sec-websocket-extensions"];
  if (claimed === undefined) return { accepted: null };
  // A repeated header arrives as a joined string from Node and as an array from a
  // hand-built response object, and RFC 7692 allows one answer to one negotiation.
  const value = Array.isArray(claimed) ? claimed.join(", ") : claimed;
  if (options === false) return { refusal: "Server sent an extension but none was requested" };

  let offered: readonly ParsedExtension[];
  try {
    offered = parseExtensions(value).get(PERMESSAGE_DEFLATE) ?? [];
  } catch {
    return { refusal: "Invalid Sec-WebSocket-Extensions header" };
  }
  // The server picked a name nobody offered.
  if (offered.length === 0) return { refusal: "Server sent an extension but none was requested" };
  const outcome = acceptAsClient(offered[0] as ParsedExtension, options);
  return outcome ?? { accepted: null };
}
