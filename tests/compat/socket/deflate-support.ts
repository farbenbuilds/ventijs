//! The facts three `permessage-deflate` suites agree on.
//!
//! Its own module because a payload that is not reproducible across suites is a payload
//! that means something different in each of them, and the threshold cases turn on its
//! exact length: a payload under 1024 bytes would be sent uncompressed and every
//! RSV1 assertion would pass for the wrong reason.

import { WebSocketServer } from "../../../src/index";
import type { ServerOptions } from "../../../src/types/ws";

/// Repetitive enough that deflate shrinks it by an order of magnitude, and long enough
/// to clear the 1024-byte default threshold.
export const COMPRESSIBLE = "ventijs ".repeat(512);

export const COMPRESSIBLE_LENGTH = COMPRESSIBLE.length;

/// Below the threshold, so `ws` and this build both send it raw. Used for the negative
/// half of the threshold case.
export const SMALL = "short";

/// The offer a default `ws` client makes, with a bare `client_max_window_bits`.
export const WS_OFFER = "permessage-deflate; client_max_window_bits";

/// The answer this build writes. Both `no_context_takeover` parameters, always, because
/// the compressor is one-shot; see `src/compat/extensions/deflate.ts`.
export const NEGOTIATED =
  "permessage-deflate; server_no_context_takeover; client_no_context_takeover";

/// A server with compression on, because `ws` defaults a *server* to off
/// (`websocket-server.js:76`). Every case here is about the extension being negotiated
/// at all, so without this the whole file would pass on an uncompressed connection.
export function deflateServer(options: ServerOptions = {}): WebSocketServer {
  return new WebSocketServer({ noServer: true, perMessageDeflate: true, ...options });
}
