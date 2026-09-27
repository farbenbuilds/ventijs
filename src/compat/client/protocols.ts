import { createError } from "../errors";

/// RFC 6455 section 11.3.4: a subprotocol is a token per RFC 7230.
const TOKEN = /^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/;

/// The subprotocols to offer, validated and de-duplicated by position.
///
/// `ws` refuses the whole list rather than dropping what it does not understand,
/// because a caller that asked for two protocols and silently got one has no way to
/// notice: the server picks, the client never sees what it dropped.
export function normalizeProtocols(protocols?: string | string[]): string[] {
  if (protocols === undefined) return [];
  const list = typeof protocols === "string" ? [protocols] : protocols;
  if (!Array.isArray(list)) {
    throw createError(
      "ERR_INVALID_OPTION",
      "An invalid or duplicated subprotocol was specified",
      SyntaxError,
    );
  }
  const seen = new Set<string>();
  for (const protocol of list) {
    if (typeof protocol !== "string" || !TOKEN.test(protocol) || seen.has(protocol)) {
      throw createError(
        "ERR_INVALID_OPTION",
        "An invalid or duplicated subprotocol was specified",
        SyntaxError,
      );
    }
    seen.add(protocol);
  }
  return [...list];
}

/// The subprotocols the client offered, for the response to be checked against.
export type ProtocolSet = ReadonlySet<string>;

export function protocolSet(protocols: readonly string[]): ProtocolSet {
  return new Set(protocols);
}
