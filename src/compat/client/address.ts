import { createError } from "../errors";

/// A parsed client address, and everything the transport and the request need.
export type ClientAddress = {
  /// The `ws:` or `wss:` URL, which is what `ws` reports as `url`.
  readonly url: string;
  readonly secure: boolean;
  /// The host, with an IPv6 literal's brackets removed, because `net` and `tls` want
  /// the address rather than the URL form.
  readonly host: string;
  readonly port: number;
  /// The request target: path and query, with a `/` when the URL has neither.
  readonly path: string;
  /// Basic credentials from the URL, if it carried any.
  readonly auth: string | undefined;
};

const DEFAULT_PORTS = { "ws:": 80, "wss:": 443 } as const;

const WS_SCHEMES = {
  "http:": "ws:",
  "https:": "wss:",
  "ws:": "ws:",
  "wss:": "wss:",
} as const;

type Scheme = keyof typeof WS_SCHEMES;

export type ClientScheme = "ws:" | "wss:";

/// Parses a client address the way `ws` does, including its errors.
///
/// Every refusal here is a `SyntaxError`, because a bad address is a programming
/// error: `ws` throws from the constructor, and a caller that catches it can fix its
/// own mistake. A bad *redirect* target is the same refusal reported differently,
/// which the caller decides because by then the socket already exists.
export function parseAddress(address: string | URL): ClientAddress {
  const parsed = toUrl(address);
  const scheme = parsed.protocol as Scheme;
  const resolved = WS_SCHEMES[scheme];
  if (resolved === undefined) {
    throw createError(
      "ERR_INVALID_OPTION",
      'The URL\'s protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"',
      SyntaxError,
    );
  }
  if (parsed.hash) {
    throw createError("ERR_INVALID_OPTION", "The URL contains a fragment identifier", SyntaxError);
  }
  return build(parsed, resolved);
}

function toUrl(address: string | URL): URL {
  if (address instanceof URL) return address;
  try {
    return new URL(address);
  } catch {
    throw createError("ERR_INVALID_OPTION", `Invalid URL: ${address}`, SyntaxError);
  }
}

function build(parsed: URL, scheme: ClientScheme): ClientAddress {
  // The scheme is rewritten before the href is read, so `url` reports the `ws:`
  // form even when the caller passed `http:`, which is what `ws` reports.
  parsed.protocol = scheme;
  const hasCredentials = parsed.username !== "" || parsed.password !== "";
  return {
    url: parsed.href,
    secure: scheme === "wss:",
    host: parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname,
    port: parsed.port === "" ? DEFAULT_PORTS[scheme] : Number(parsed.port),
    path: `${parsed.pathname}${parsed.search}`,
    auth: hasCredentials ? `${parsed.username}:${parsed.password}` : undefined,
  };
}
