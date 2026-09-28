/// The opening handshake, as `http.RequestOptions`. Header order is fixed and
/// `tests/conformance/` compares two handshakes field by field, so it is a property of
/// this function, not of the library that enumerates it.

import type { RequestOptions } from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type { NormalizedClientOptions } from "../../types/options";
import { offer } from "../extensions/offer";
import type { ClientAddress } from "./address";

/// RFC 6455 section 1.3: the constant the accept digest is derived from.
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function expectedAccept(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/// RFC 6455 section 4.1 asks for a 16-byte nonce, and it makes the handshake a proof of
/// a live endpoint rather than a cache replay.
export function newKey(): string {
  return randomBytes(16).toString("base64");
}

export type Handshake = {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
  /// The options the request module is called with, minus the ones it fills in. Typed as
  /// the wider of the two so TLS fields are name-checked, not smuggled as an index type.
  readonly request: RequestOptions;
};

/// `carriedAuth` is credentials from an earlier hop: a redirect's `Location` names a URL
/// and not the credentials dialled.
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
  // The offer, not a negotiation. RFC 7692 section 7.1.1.1: a server that does not answer
  // sends uncompressed frames, a normal connection either way.
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
    // A header, not `http.request`'s `auth`, which is applied after the caller's own and
    // would replace an explicit `Authorization`. `ws` does the same, so the redirect path
    // can strip it.
    withCaller.authorization = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  }
  return {
    key,
    headers: withCaller,
    request: {
      // `hostname`, not `host`, which here is the name to resolve: `host:port` would ask
      // for a host *named* `127.0.0.1:42989`. `Host` is explicit below because Node drops
      // the port when it is the scheme's default and `ws` never does.
      hostname: address.host,
      port: address.port,
      path: address.path,
      method: "GET",
      headers: { host: hostHeader(address), ...withCaller },
      // The caller's must win, because `ws` sends the URL's authority verbatim.
      setHost: false,
      ...transportOptions(address),
    },
  };
}

/// The only place TLS is chosen. `rejectUnauthorized` is stated rather than inherited
/// because the default has moved between Node majors and a drop-in must not move too.
function transportOptions(address: ClientAddress): RequestOptions {
  if (address.socketPath !== undefined) return { socketPath: address.socketPath };
  if (!address.secure) return {};
  return { servername: address.host, rejectUnauthorized: true };
}

/// A domain socket has no authority to name and `http.request` sends the path as `Host`.
/// Inventing `localhost` would put a routable name the caller never configured there.
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
