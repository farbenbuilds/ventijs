import { offer } from "../extensions/offer";
import type { NormalizedClientOptions } from "../../types/options";

export type HandshakeHeaders = {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
};

/// What the opening handshake puts on the wire, as `ws` puts it there; every ordering below is
/// `ws`'s and observable. `credentials` is the URL's own or one carried from an earlier hop.
export function buildHeaders(
  options: NormalizedClientOptions,
  protocols: readonly string[],
  key: string,
  credentials: string | undefined,
): HandshakeHeaders {
  const headers: Record<string, string> = {
    "Sec-WebSocket-Version": String(options.protocolVersion),
    "Sec-WebSocket-Key": key,
    Connection: "Upgrade",
    Upgrade: "websocket",
  };
  if (protocols.length > 0) headers["Sec-WebSocket-Protocol"] = protocols.join(",");
  // An offer, not a negotiation: RFC 7692 section 7.1.1.1, a server that does not answer it
  // sends uncompressed frames, so the connection is normal either way.
  const extension = offer(options.perMessageDeflate);
  if (extension !== undefined) headers["Sec-WebSocket-Extensions"] = extension;
  // Truthiness, not presence: `ws` gates on `if (opts.origin)`, so an empty string sends no
  // header. Version 13 sends `Origin`; draft 8 sent `Sec-WebSocket-Origin`.
  if (options.origin) {
    if (options.protocolVersion < 13) headers["Sec-WebSocket-Origin"] = options.origin;
    else headers.Origin = options.origin;
  }
  // The caller's under the library's, `ws`'s order: a caller merging its own headers in must
  // not be able to make this not an upgrade. `Authorization` is a header rather than
  // `http.request`'s `auth`, which is applied after the caller's own and would replace it,
  // and is filled in only when the caller set none.
  const merged = { ...lowerCased(options.headers), ...headers };
  if (credentials !== undefined && merged.authorization === undefined) {
    merged.authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  }
  return { key, headers: merged };
}

/// Folded to lower case so a caller's `Sec-WebSocket-Key` collides with the library's rather
/// than differing only in case, which every parser accepts and no server can reconcile.
function lowerCased(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name.toLowerCase()] = value;
  }
  return out;
}
