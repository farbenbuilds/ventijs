import { createError } from "../errors";
import type { ProtocolSet } from "./protocols";
import { expectedAccept, type Handshake } from "./request";

/// The response line and headers of an opening handshake.
export type HandshakeResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /// The bytes that followed the header block, which is the frame stream.
  readonly rest: Buffer;
};

/// Splits a handshake response from the frame stream that may share the read.
export function parseResponse(bytes: Buffer): HandshakeResponse {
  const text = bytes.toString("latin1");
  const end = text.indexOf("\r\n\r\n");
  if (end === -1) {
    throw createError("ERR_PROTOCOL", "ventijs: the handshake response was truncated", Error);
  }
  const lines = text.slice(0, end).split("\r\n");
  const status = Number(/^HTTP\/1\.1 (\d{3})\b/.exec(lines[0] ?? "")?.[1] ?? 0);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    // Lowercased because a peer may send any casing and the checks below all name
    // headers the way `ws` does.
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return {
    status,
    headers,
    rest: bytes.subarray(Buffer.byteLength(text.slice(0, end + 4), "latin1")),
  };
}

/// Why a 101 is not a usable connection, or null when it is.
///
/// A server that is not a WebSocket server can say 101 to anything, so every field of
/// the response is checked rather than the status alone: a wrong `Upgrade` means the
/// peer upgraded to something else, and a wrong digest means the response belongs to
/// a different request. Both are connections a caller must not send a byte down.
export function rejection(
  response: HandshakeResponse,
  handshake: Handshake,
  offered: ProtocolSet,
): string | null {
  if (response.status !== 101) return `Unexpected server response: ${response.status}`;
  const upgrade = response.headers.upgrade;
  if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
    return "Invalid Upgrade header";
  }
  if (response.headers["sec-websocket-accept"] !== expectedAccept(handshake.key)) {
    return "Invalid Sec-WebSocket-Accept header";
  }
  return protocolRejection(response.headers["sec-websocket-protocol"], offered);
}

/// The subprotocol check, kept apart because it is the only part of the response the
/// application can influence.
///
/// A server that picks nothing when the client offered something is a protocol
/// error rather than a default: the client asked for a language or a subprotocol and
/// would otherwise have no way to notice it got something else.
function protocolRejection(chosen: string | undefined, offered: ProtocolSet): string | null {
  if (chosen === undefined) {
    return offered.size > 0 ? "Server sent no subprotocol" : null;
  }
  if (offered.size === 0) return "Server sent a subprotocol but none was requested";
  if (!offered.has(chosen)) return "Server sent an invalid subprotocol";
  return null;
}

/// The extensions header a client accepts, and what to report for it.
///
/// A client that offered nothing must refuse whatever the server claims: accepting
/// an extension this build does not implement would mean the peer compresses and this
/// side does not, which is a stream neither end can read.
export function extensionsRejection(response: HandshakeResponse, offered: boolean): string | null {
  const claimed = response.headers["sec-websocket-extensions"];
  if (claimed === undefined) return null;
  if (!offered) return "Server sent an extension but none was requested";
  return null;
}
