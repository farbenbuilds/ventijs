/// The opening handshake, as `http.RequestOptions`.
///
/// Split out of `dial.ts` because the request is one decision -- which URL, which
/// headers, which transport -- and the request *lifecycle* is another. The previous
/// route built a request line and a header block as bytes and read them back off a
/// socket it had opened itself, which is the whole reason `upgrade`,
/// `unexpected-response`, and `redirect` had no `ClientRequest` to hand a caller:
/// there was no request object, only a socket and some bytes.
///
/// **The header order is still fixed**, and `tests/conformance/` still compares two
/// handshakes field by field. `http.request` writes the headers in the order the object
/// enumerates them, so the order is a property of this function rather than of the
/// library underneath it.

import type { RequestOptions } from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type { NormalizedClientOptions } from "../../types/options";
import { offer } from "../extensions/offer";
import type { ClientAddress } from "./address";

/// RFC 6455 section 1.3: the constant the accept digest is derived from.
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// The accept value a server must echo for this key.
export function expectedAccept(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/// A fresh key: 16 random bytes, base64-encoded. RFC 6455 section 4.1 asks for a
/// nonce of 16 bytes, and it is what makes the handshake a proof the peer is a live
/// endpoint rather than a cache replaying a response.
export function newKey(): string {
  return randomBytes(16).toString("base64");
}

export type Handshake = {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
  /// The options the request module is called with, minus the ones it fills in itself.
  /// Typed as the `https` options because that is the wider of the two, so the TLS
  /// fields are name-checked rather than smuggled through as an index signature.
  readonly request: RequestOptions;
};

/// Builds the opening request.
///
/// `carriedAuth` is credentials forwarded from an earlier hop, because a redirect's
/// `Location` names a URL and not the credentials a caller put in the one they dialled.
export function buildRequest(
  address: ClientAddress,
  options: NormalizedClientOptions,
  protocols: readonly string[],
  key: string,
  carriedAuth?: string,
): Handshake {
  const headers: Record<string, string> = {
    "Sec-WebSocket-Version": String(options.protocolVersion),
    "Sec-WebSocket-Key": key,
    Connection: "Upgrade",
    Upgrade: "websocket",
  };
  if (protocols.length > 0) headers["Sec-WebSocket-Protocol"] = protocols.join(",");
  // The offer, not the negotiation. RFC 7692 section 7.1.1.1: a client asks, and a
  // server that does not answer sends uncompressed frames, which is a normal connection
  // rather than a degraded one.
  const extension = offer(options.perMessageDeflate);
  if (extension !== undefined) headers["Sec-WebSocket-Extensions"] = extension;
  if (options.origin !== undefined) {
    // Version 13 sends `Origin`; the draft version 8 sent `Sec-WebSocket-Origin`.
    if (options.protocolVersion < 13) headers["Sec-WebSocket-Origin"] = options.origin;
    else headers.Origin = options.origin;
  }
  const withCaller = { ...headers, ...lowerCased(options.headers) };
  const credentials = address.auth ?? carriedAuth;
  if (credentials !== undefined) {
    // Written as a header rather than through `http.request`'s `auth` option because
    // `auth` is applied after the caller's own headers, so a caller who set
    // `Authorization` explicitly would have it replaced. `ws` puts it in the headers
    // for the same reason, and the redirect path can then strip it, which it could not
    // do to a value `http.request` owns.
    withCaller.authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  }
  return {
    key,
    headers: withCaller,
    request: {
      // `hostname`, not `host`: in `http.request`'s options `host` is the name to
      // resolve, and passing `host:port` there asks for a host *named* `127.0.0.1:42989`.
      // The `Host` header is written explicitly below instead, because Node omits the
      // port when it is the scheme's default and `ws` never does.
      hostname: address.host,
      port: address.port,
      path: address.path,
      method: "GET",
      headers: { host: hostHeader(address), ...withCaller },
      // Node would otherwise add its own `Host`, and the caller's has to win because
      // `ws` sends the URL's authority verbatim.
      setHost: false,
      ...transportOptions(address),
    },
  };
}

/// The transport half of the options, which is the only place TLS is chosen.
///
/// `ws` makes the same choice from the scheme, and the certificate is verified against
/// Node's default CA set exactly as `ws` leaves it: a drop-in that skipped verification
/// would accept every certificate a proxy presented, which is the one behaviour a caller
/// cannot detect from the outside. `rejectUnauthorized` is stated rather than inherited
/// because the default has changed between Node majors, and a drop-in must not move with
/// it.
function transportOptions(address: ClientAddress): RequestOptions {
  if (address.socketPath !== undefined) return { socketPath: address.socketPath };
  if (!address.secure) return {};
  return { servername: address.host, rejectUnauthorized: true };
}

/// A domain socket has no authority to name, and `http.request` over `socketPath` sends
/// the path as the `Host` header. Inventing `localhost` would put a name in the handshake
/// that the peer never asked for, and a name a server routes on is a name a caller did
/// not configure.
function hostHeader(address: ClientAddress): string {
  if (address.socketPath !== undefined) return address.socketPath;
  const bracketed = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${bracketed}:${address.port}`;
}

function lowerCased(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name.toLowerCase()] = value;
  }
  return out;
}
