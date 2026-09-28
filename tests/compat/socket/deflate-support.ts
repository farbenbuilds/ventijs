//! The facts three `permessage-deflate` suites share. Under 1024 bytes a payload goes out
//! raw, so the threshold cases would pass for the wrong reason.

import { WebSocketServer } from "../../../src/index";
import type { ServerOptions } from "../../../src/types/ws";

/// Shrinks tenfold and clears the 1024-byte threshold.
export const COMPRESSIBLE = "ventijs ".repeat(512);

export const COMPRESSIBLE_LENGTH = COMPRESSIBLE.length;

/// Below the threshold, so both builds send it raw.
export const SMALL = "short";

export const WS_OFFER = "permessage-deflate; client_max_window_bits";

/// This build's answer; one-shot compressor, so both `no_context_takeover`.
export const NEGOTIATED =
  "permessage-deflate; server_no_context_takeover; client_no_context_takeover";

/// Compression on: `ws` defaults a server off (`websocket-server.js:76`).
export function deflateServer(options: ServerOptions = {}): WebSocketServer {
  return new WebSocketServer({ noServer: true, perMessageDeflate: true, ...options });
}
