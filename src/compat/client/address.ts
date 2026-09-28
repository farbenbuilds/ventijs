import { createError } from "../errors";

/// A parsed client address, and everything the transport and the request need.
export type ClientAddress = {
  readonly url: string;
  readonly secure: boolean;
  /// The host, with an IPv6 literal's brackets removed: `net` and `tls` want the address,
  /// not the URL form.
  readonly host: string;
  /// `host:port`, what a redirect is compared against: two peers on one host and
  /// different ports are different origins, so comparing hostnames alone would carry a
  /// password across that boundary.
  readonly authority: string;
  readonly port: number;
  readonly path: string;
  readonly auth: string | undefined;
  /// The UNIX domain socket or Windows named pipe to dial, for a `ws+unix:` address. A
  /// value rather than a flag, because a path and a host are two different things to
  /// `net.connect` and a caller reading this cannot tell which it got.
  readonly socketPath: string | undefined;
};

const DEFAULT_PORTS = { "ws:": 80, "wss:": 443 } as const;

/// The schemes `ws` accepts, and the two it rewrites. `ws+unix:` is the IPC form: it
/// maps to neither and is handled below, so it is here only to be recognised, not
/// refused.
const WS_SCHEMES = {
  "http:": "ws:",
  "https:": "wss:",
  "ws:": "ws:",
  "wss:": "wss:",
  "ws+unix:": "ws:",
} as const;

const IPC_SCHEME = "ws+unix:";

type Scheme = keyof typeof WS_SCHEMES;

export type ClientScheme = "ws:" | "wss:";

/// Parses a client address the way `ws` does, including its errors. Every refusal is a
/// `SyntaxError`, because a bad address is a programming error and `ws` throws from the
/// constructor; a bad *redirect* target is the same refusal reported differently, which
/// the caller decides because the socket already exists.

// The IPC form is `ws+unix:<socket path>[:<request target>]`, split on the first colon
// after the scheme, so the path may be a POSIX path or a Windows named pipe.
export function parseAddress(address: string | URL): ClientAddress {
  const parsed = toUrl(address);
  const scheme = parsed.protocol as Scheme;
  if (scheme === IPC_SCHEME) return buildIpc(parsed);
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
  // The scheme is rewritten before the href is read, so `url` reports the `ws:` form
  // even for an `http:` input, as `ws` does.
  parsed.protocol = scheme;
  const hasCredentials = parsed.username !== "" || parsed.password !== "";
  const host = parsed.hostname.startsWith("[") ? parsed.hostname.slice(1, -1) : parsed.hostname;
  const port = parsed.port === "" ? DEFAULT_PORTS[scheme] : Number(parsed.port);
  return {
    url: parsed.href,
    secure: scheme === "wss:",
    host,
    authority: parsed.host,
    port,
    path: `${parsed.pathname}${parsed.search}`,
    auth: hasCredentials ? `${parsed.username}:${parsed.password}` : undefined,
    socketPath: undefined,
  };
}

/// An IPC address: the socket path, the request target, and nothing else. `url` is the
/// caller's own href, because `ws` reads `websocket.url` before rewriting anything and
/// an IPC address has no host to rewrite. Port 80 is conventional, as it is for `ws:`.
function buildIpc(parsed: URL): ClientAddress {
  if (parsed.pathname === "") {
    throw createError("ERR_INVALID_OPTION", "The URL's pathname is empty", SyntaxError);
  }
  if (parsed.hash) {
    throw createError("ERR_INVALID_OPTION", "The URL contains a fragment identifier", SyntaxError);
  }
  const parts = parsed.pathname.split(":");
  const socketPath = parts[0] ?? "";
  // `ws` leaves the target `undefined` when the URL gave no path and lets
  // `http.request` default, which is the same request as `/`.
  const target = parts.length > 1 ? parts.slice(1).join(":") : "";
  return {
    url: parsed.href,
    secure: false,
    host: "",
    authority: socketPath,
    port: DEFAULT_PORTS["ws:"],
    path: target === "" ? "/" : `/${target.replace(/^\/+/, "")}${parsed.search}`,
    auth: undefined,
    socketPath,
  };
}
