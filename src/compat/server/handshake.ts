import { createHash } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerState } from "../../types/server";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { listenerCount } from "../events/registry";
import { parseProtocolHeader, isProtocolToken } from "../options/shared";

export const KEY_PATTERN = /^[+/0-9A-Za-z]{22}==$/;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const STATUS_MIN = 100;
const STATUS_MAX = 599;

type TlsSocketInfo = {
  readonly authorized?: boolean;
  readonly encrypted?: boolean;
};

function hasControlCharacters(value: string): boolean {
  return value.includes("\u0000") || value.includes("\r") || value.includes("\n");
}

export function socketAccept(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

export function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function isSecure(request: IncomingMessage): boolean {
  const socket = request.socket as TlsSocketInfo;
  return Boolean(socket.authorized || socket.encrypted);
}

/// Returns undefined once the rejection is written.
export function parseProtocols(
  state: ServerState,
  request: IncomingMessage,
  socket: Duplex,
): readonly string[] | undefined {
  const header = request.headers["sec-websocket-protocol"];
  if (header === undefined) return [];
  try {
    return parseProtocolHeader(Array.isArray(header) ? header.join(",") : header);
  } catch {
    abortOrEmit(state, request, socket, 400, "Invalid Sec-WebSocket-Protocol header");
    return undefined;
  }
}

/// `handleProtocols` owns the decision when present, otherwise `ws` takes the first
/// offered protocol. A hook result that is not a valid token is refused rather than echoed
/// into a response header.
export function selectProtocol(
  state: ServerState,
  protocols: readonly string[],
  request: IncomingMessage,
): string | false {
  if (protocols.length === 0) return false;
  const offered = new Set(protocols);
  const handleProtocols = state.options.handleProtocols;
  const selected = handleProtocols ? handleProtocols(offered, request) : (protocols[0] ?? false);
  if (!isProtocolToken(selected)) return false;
  return selected;
}

/// The coded error keeps the stable `ERR_PROTOCOL` surface while the message stays
/// byte-identical to `ws`. `headers` only rides along with the written rejection,
/// matching upstream: the emitted error carries none.
export function abortOrEmit(
  state: ServerState,
  request: IncomingMessage,
  socket: Duplex,
  code: number,
  message: string,
  headers?: OutgoingHttpHeaders,
): void {
  if (listenerCount(state.listeners, "wsClientError") > 0) {
    emitEvent(state, "wsClientError", createError("ERR_PROTOCOL", message), socket, request);
    return;
  }
  abortHandshake(socket, code, message, headers);
}

/// Writes the HTTP error response `ws` sends when preconditions fail. The
/// caller-owned headers merge over the defaults, but control characters are
/// stripped first so an application-supplied value cannot split the response.
export function abortHandshake(
  socket: Duplex,
  code: number,
  message?: string,
  headers?: OutgoingHttpHeaders,
): void {
  const status = Number.isInteger(code) && code >= STATUS_MIN && code <= STATUS_MAX ? code : 500;
  const body = message || STATUS_CODES[status] || "";
  const merged: OutgoingHttpHeaders = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(body),
    ...sanitizeHeaders(headers),
  };
  const lines = Object.keys(merged)
    .map((name) => `${name}: ${String(merged[name])}`)
    .join("\r\n");
  socket.once("finish", () => {
    socket.destroy();
  });
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\n${lines}\r\n\r\n${body}`);
}

/// Drops any header whose name or value carries a control character. `ws`
/// forwards them verbatim; this is a deliberate hardening divergence.
function sanitizeHeaders(headers?: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const safe: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (hasControlCharacters(name)) continue;
    const values = Array.isArray(value) ? value : [value];
    const unsafe = values.some(
      (entry) => entry !== undefined && hasControlCharacters(String(entry)),
    );
    if (unsafe) continue;
    safe[name] = value;
  }
  return safe;
}
