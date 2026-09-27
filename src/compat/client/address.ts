import { createError } from "../errors";

/// A parsed client address, and everything the transport and the request need.
export type ClientAddress = {
  /// The `ws:` or `wss:` URL, which is what `ws` reports as `url`.
  readonly url: string;
  readonly secure: boolean;
  /// The host, with an IPv6 literal's brackets removed, because `net` and `tls` want
  /// the address rather than the URL form.
  readonly host: string;
  /// `host:port`, which is what a redirect is compared against. Two peers on one host
  /// but different ports are different origins, and a credential given to one is not
  /// given to the other; comparing the hostname alone would carry a password across
  /// that boundary.
  readonly authority: string;
  readonly port: number;
  /// The request target: path and query, with a `/` when the URL has neither.
  readonly path: string;
  /// Basic credentials from the URL, if it carried any.
  readonly auth: string | undefined;
  /// The UNIX domain socket or Windows named pipe to dial, for a `ws+unix:` address.
  ///
  /// Present rather than a flag, because a path and a host are two different things
  /// to `net.connect` and a caller reading it cannot tell which it got.
  readonly socketPath: string | undefined;
};

const DEFAULT_PORTS = { "ws:": 80, "wss:": 443 } as const;

/// The schemes `ws` accepts, and the two it rewrites to its own.
///
/// `ws+unix:` is the IPC form. It has no default port and no host, so it maps to
/// neither `ws:` nor `wss:` and is handled on its own below; it is in this table so
/// that a URL using it is *recognised* rather than refused, which is what the table
/// is for.
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

/// Parses a client address the way `ws` does, including its errors.
///
/// Every refusal here is a `SyntaxError`, because a bad address is a programming
/// error: `ws` throws from the constructor, and a caller that catches it can fix its
/// own mistake. A bad *redirect* target is the same refusal reported differently,
/// which the caller decides because by then the socket already exists.
///
/// The IPC form is `ws+unix:<socket path>[:<request target>]` with the first colon
/// after the scheme as the separator, so the path may be a POSIX socket path or a
/// Windows named pipe and neither may contain a colon. `ws` splits the same way and
/// says the same things about an empty pathname and an unknown scheme.
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
  // The scheme is rewritten before the href is read, so `url` reports the `ws:`
  // form even when the caller passed `http:`, which is what `ws` reports.
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

/// An IPC address: the socket path, the request target, and nothing else.
///
/// `url` is reported as the caller wrote it, scheme and all, because `ws` reports
/// `websocket.url` from the parsed href before it rewrites anything, and an IPC
/// address has no host for the rewrite to make sense of. `secure` is false because
/// there is no TLS over a domain socket, and the default port is 80 for the same
/// reason it is for `ws:`: the request line needs a `Host` header and the value is
/// conventional rather than meaningful.
function buildIpc(parsed: URL): ClientAddress {
  if (parsed.pathname === "") {
    throw createError("ERR_INVALID_OPTION", "The URL's pathname is empty", SyntaxError);
  }
  if (parsed.hash) {
    throw createError("ERR_INVALID_OPTION", "The URL contains a fragment identifier", SyntaxError);
  }
  const parts = parsed.pathname.split(":");
  const socketPath = parts[0] ?? "";
  // The request target after the separator, or `/` when the URL gave no path. `ws`
  // leaves it `undefined` in that case and lets `http.request` default, which is the
  // same thing: a request with no target is a request for `/`.
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
