/// The opening handshake, as `http.RequestOptions`. Header order is fixed because
/// `tests/conformance/` compares two handshakes field by field.

import type { RequestOptions } from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type { NormalizedClientOptions } from "../../types/options";
import { buildHeaders } from "./handshake-headers";
import { transportOptions } from "./transport-options";
import type { ClientAddress } from "./address";

/// RFC 6455 section 1.3: the constant the accept digest is derived from.
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function expectedAccept(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/// RFC 6455 section 4.1 asks for a 16-byte nonce, which makes the handshake a proof of a
/// live endpoint rather than a cache replay.
export function newKey(): string {
  return randomBytes(16).toString("base64");
}

export type Handshake = {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
  /// The options the request module is called with, minus the ones it fills in. Typed as
  /// the wider of the two so TLS fields are name-checked rather than smuggled as an index.
  readonly request: RequestOptions;
};

/// `carriedAuth` is credentials from an earlier hop: a `Location` names a URL, not the
/// credentials dialled.
export function buildRequest(
  address: ClientAddress,
  options: NormalizedClientOptions,
  protocols: readonly string[],
  key: string,
  carriedAuth?: string,
): Handshake {
  const built = buildHeaders(options, protocols, key, address.auth ?? carriedAuth);
  return {
    key: built.key,
    headers: built.headers,
    request: {
      // `hostname`, not `host`, which here is the name to resolve: `host:port` would ask for
      // a host *named* `127.0.0.1:42989`. `Host` is explicit below because Node drops the
      // port on a default port and `ws` never does.
      hostname: address.host,
      port: address.port,
      path: address.path,
      method: "GET",
      headers: { host: hostHeader(address), ...built.headers },
      // The caller's must win, because `ws` sends the URL's authority verbatim.
      setHost: false,
      ...transportOptions(address, options),
    },
  };
}

/// A domain socket has no authority to name and `http.request` sends the path as `Host`;
/// inventing `localhost` would put a routable name the caller never configured there.
function hostHeader(address: ClientAddress): string {
  if (address.socketPath !== undefined) return address.socketPath;
  const bracketed = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${bracketed}:${address.port}`;
}
