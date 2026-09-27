import type { Socket } from "node:net";
import type { NormalizedClientOptions } from "../../types/options";
import type { SocketState } from "../../types/socket";
import type { ClientOptions, WebSocket } from "../../types/ws";
import { normalizeClientOptions } from "../options/client";
import { finishConnection } from "../socket/lifecycle";
import { buildSocketRecord } from "../socket/record";
import { createSocketState } from "../socket/state";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { parseAddress } from "./address";
import { normalizeProtocols, protocolSet, type ProtocolSet } from "./protocols";
import { buildRequest, newKey, type Handshake } from "./request";
import { respond } from "./open";
import { connectionError, openTransport } from "./transport";
import { readHead } from "./head";

const CLOSE_ABNORMAL = 1006;

/// One attempt at one address.
///
/// A redirect replaces the transport, the address, and the handshake and leaves
/// everything else alone, which is why the socket's state is the thing that survives
/// and the attempt is what gets thrown away.
export type Attempt = {
  readonly state: SocketState;
  readonly options: NormalizedClientOptions;
  readonly requested: readonly string[];
  readonly offered: ProtocolSet;
  transport: Socket;
  handshake: Handshake;
  redirects: number;
};

/// Starts a client connection and returns the socket record.
///
/// Only the first two steps can throw: a bad address or subprotocol is a programming
/// error, and a caller who fixes it can try again. Everything after them is reported
/// through the socket, because by then the caller holds a handle to it.
export function connectSocket(
  address: string | URL,
  protocols: string | string[] | undefined,
  options: ClientOptions | undefined,
): WebSocket {
  const normalized = normalizeClientOptions(options);
  const parsed = parseAddress(address);
  const requested = normalizeProtocols(protocols);
  const state = createSocketState();
  state.isServer = false;
  state.url = parsed.url;
  const socket = buildSocketRecord(state);
  begin(state, normalized, requested, parsed.url);
  return socket;
}

/// Opens the transport, writes the request, and reads the response.
function begin(
  state: SocketState,
  options: NormalizedClientOptions,
  requested: readonly string[],
  url: string,
): void {
  const address = parseAddress(url);
  const transport = openTransport(address);
  const attempt: Attempt = {
    state,
    options,
    requested,
    offered: protocolSet(requested),
    transport,
    handshake: buildRequest(address, options, requested, newKey()),
    redirects: 0,
  };
  transport.on("error", (error: Error) => {
    abort(attempt, connectionError(error));
  });
  if (options.handshakeTimeout !== undefined) {
    transport.setTimeout(options.handshakeTimeout, () => {
      abort(attempt, createError("ERR_PROTOCOL", "Opening handshake has timed out"));
    });
  }
  transport.write(attempt.handshake.request, "latin1");
  readHead(
    transport,
    Buffer.alloc(0),
    (rest) => {
      respond(attempt, rest);
    },
    () => {
      abort(attempt, createError("ERR_PROTOCOL", "Opening handshake response too large"));
    },
  );
}

/// Refuses the connection, as `ws` does: `error`, then `close`, with the transport
/// destroyed so nothing keeps a half-open connection alive.
///
/// The code is 1006 because no close frame was exchanged; a peer learns nothing from
/// us, which is precisely what 1006 describes.
export function abort(attempt: Attempt, error: Error): void {
  const { state, transport } = attempt;
  if (state.readyState === CLOSED) return;
  transport.destroy();
  state.readyState = CLOSED;
  if (state.errorEmitted) {
    finishConnection(state, CLOSE_ABNORMAL, Buffer.alloc(0));
    return;
  }
  state.errorEmitted = true;
  try {
    emitEvent(state, "error", error);
  } finally {
    finishConnection(state, CLOSE_ABNORMAL, Buffer.alloc(0));
  }
}
