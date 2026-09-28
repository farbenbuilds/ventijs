/// The `http.request` and TLS options a `wss:` client forwards, as `ws` forwards them.
/// `ws` spreads the caller's object straight into `http.request` (`websocket.js:759`), and
/// `@types/ws` types them as `SecureContextOptions` plus the request options, so a caller
/// pinning a private CA or routing through a proxy reaches Node through these keys. A
/// drop-in that drops them fails with a certificate error naming a certificate the caller
/// supplied, which is the worst way to find out.

import type { RequestOptions } from "node:https";
import type { NormalizedClientOptions } from "../../types/options";
import type { ClientAddress } from "./address";

/// A list rather than the whole object, because it is the normalized copy of the caller's
/// options and a getter on an unrelated key would then run on every dial. The authority,
/// path, method and headers are absent on purpose: the handshake decides those.
const FORWARDED = [
  "ca",
  "cert",
  "key",
  "pfx",
  "passphrase",
  "secureContext",
  "rejectUnauthorized",
  "checkServerIdentity",
  "servername",
  "agent",
  "createConnection",
  "localAddress",
  "family",
  "lookup",
  "insecureHTTPParser",
  "maxHeaderSize",
  "joinDuplicateHeaders",
  "signal",
] as const;

export function transportOptions(
  address: ClientAddress,
  options: NormalizedClientOptions,
): RequestOptions {
  const carried: Record<string, unknown> = {};
  for (const key of FORWARDED) {
    const value = options.requestOptions[key];
    if (value !== undefined) carried[key] = value;
  }
  if (address.socketPath !== undefined) return { ...carried, socketPath: address.socketPath };
  // Not `secure`, so the TLS keys do not apply: a plain `ws:` request has no TLS fields.
  if (!address.secure) return carried;
  return {
    ...carried,
    // Stated rather than inherited, because the default has moved between Node majors and
    // a drop-in must not move too. Only the absent case is filled in, so a caller who set
    // either has already overridden it above.
    servername: stringOr(carried.servername, address.host),
    rejectUnauthorized: booleanOr(carried.rejectUnauthorized, true),
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
