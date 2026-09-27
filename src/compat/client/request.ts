import { createHash, randomBytes } from "node:crypto";
import type { NormalizedClientOptions } from "../../types/options";
import type { ClientAddress } from "./address";
import { offer } from "../extensions/offer";

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

/// The opening request, as bytes and as the headers it carries.
export type Handshake = {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly request: string;
};

/// Builds the opening request.
///
/// `Host` is written first and the rest follow in a fixed order, because
/// `tests/conformance/` compares two handshakes byte for byte and the order is
/// observable there. A caller's own headers are applied last so an explicit `Host`
/// replaces ours rather than sitting beside it, which is what a caller supplying
/// `Host` is asking for.
export function buildRequest(
  address: ClientAddress,
  options: NormalizedClientOptions,
  protocols: readonly string[],
  key: string,
  /// Credentials carried forward from an earlier hop, because a redirect's `Location`
  /// names a URL and not the credentials a caller put in the one they dialled.
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
  // server that does not answer sends uncompressed frames, which is a normal
  // connection rather than a degraded one.
  const extension = offer(options.perMessageDeflate);
  if (extension !== undefined) headers["Sec-WebSocket-Extensions"] = extension;
  if (options.origin !== undefined) {
    // Version 13 sends `Origin`; the draft version 8 sent `Sec-WebSocket-Origin`.
    if (options.protocolVersion < 13) headers["Sec-WebSocket-Origin"] = options.origin;
    else headers.Origin = options.origin;
  }
  const credentials = address.auth ?? carriedAuth;
  if (credentials !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  }
  const withCaller = { ...headers, ...lowerCased(options.headers) };
  return { key, headers: withCaller, request: render(address, withCaller) };
}

function lowerCased(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    out[name.toLowerCase()] = value;
  }
  return out;
}

function render(address: ClientAddress, headers: Readonly<Record<string, string>>): string {
  const lines = [`GET ${address.path} HTTP/1.1`];
  if (headers.host === undefined) lines.push(`Host: ${hostHeader(address)}`);
  for (const [name, value] of Object.entries(headers)) {
    if (name === "host") lines.push(`Host: ${value}`);
    else lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function hostHeader(address: ClientAddress): string {
  // A domain socket has no authority to name, and `http.request` over `socketPath`
  // sends the path as the `Host` header. Inventing `localhost` would put a name in the
  // handshake that the peer never asked for, and a name a server routes on is a name
  // a caller did not configure.
  if (address.socketPath !== undefined) return address.socketPath;
  const bracketed = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${bracketed}:${address.port}`;
}
