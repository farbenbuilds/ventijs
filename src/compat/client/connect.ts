import type { Socket } from "node:net";
import type { NormalizedClientOptions } from "../../types/options";
import type { SocketState } from "../../types/socket";
import type { ClientOptions, WebSocket } from "../../types/ws";
import { normalizeClientOptions } from "../options/client";
import { failConnection } from "../socket/lifecycle";
import { buildSocketRecord } from "../socket/record";
import { createSocketState } from "../socket/state";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { parseAddress, type ClientAddress } from "./address";
import { normalizeProtocols, protocolSet, type ProtocolSet } from "./protocols";
import { buildRequest, newKey, type Handshake } from "./request";
import { thresholdOf } from "../extensions/threshold";
import { respond } from "./open";
import { connectionError, openTransport } from "./transport";
import { readHead } from "./head";

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
  /// The address this attempt is for, which is what a redirect's host and scheme are
  /// compared against: the original one, not the previous hop. A chain that wanders
  /// off `wss:` is refused on the first downgrade, wherever in the chain it happens.
  address: ClientAddress;
  /// The credentials the caller dialled with, kept while a redirect stays on the same
  /// host and dropped the moment it does not. A `Location` names a URL and carries no
  /// credentials, so without this a same-host redirect would silently un authenticate
  /// a client that authenticated.
  auth: string | undefined;
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
  state.closeTimeout = normalized.closeTimeout;
  state.autoPong = normalized.autoPong;
  state.allowSynchronousEvents = normalized.allowSynchronousEvents;
  state.validateUtf8 = !normalized.skipUTF8Validation;
  state.maxPayload = normalized.maxPayload;
  state.maxFragments = normalized.maxFragments;
  // The threshold is known before the handshake, so it is set here; whether the
  // extension was actually negotiated is not, and `open.ts` sets that from the response.
  state.threshold = thresholdOf(normalized.perMessageDeflate);
  const socket = buildSocketRecord(state);
  const transport = openTransport(parsed);
  const attempt: Attempt = {
    state,
    options: normalized,
    requested,
    offered: protocolSet(requested),
    transport,
    handshake: buildRequest(parsed, normalized, requested, newKey()),
    address: parsed,
    auth: parsed.auth,
    redirects: 0,
  };
  // Deliberately not attached yet: the socket's transport and codec are attached when
  // the 101 arrives, because the response is not frames, and a codec that read it would
  // refuse the connection with a 1002 before a single legitimate frame was sent. Until
  // then the socket is `CONNECTING` with no transport, which is what makes
  // `close()` and `terminate()` on a client that has not opened report the aborted
  // handshake the way `ws` does.
  dial(attempt);
  return socket;
}

/// Wires an attempt's transport and reads its response.
///
/// Exported because a redirect replaces the transport and re-enters here: one dial is
/// the unit of work, and a chain of redirects is several dials against one socket.
export function dial(attempt: Attempt): void {
  const { transport, options } = attempt;
  transport.on("error", (error: Error) => {
    abort(attempt, connectionError(error));
  });
  if (options.handshakeTimeout !== undefined) {
    // Re-armed for every hop, because each dial is a fresh handshake and a caller who
    // set a deadline meant it per handshake rather than for the whole chain.
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
///
/// This delegates the latch to `failConnection`, which is `ws`'s `emitErrorAndClose`
/// exactly, and the delegation is the point. Latching `CLOSED` here before dispatching
/// was self-defeating: `finishConnection` is the only path to `CLOSED` and it returns
/// immediately on a socket that is already there, so every one of these refusals set the
/// state and then skipped the event. A caller waiting on `close` to learn the handshake
/// failed — which is the usual shape, since a rejected handshake is only ever observable
/// through the two events — hung for the life of the process, and the tests missed it
/// because they asserted `readyState`, which was 3.
export function abort(attempt: Attempt, error: Error): void {
  const { state, transport } = attempt;
  if (state.readyState === CLOSED) return;
  transport.destroy();
  failConnection(state, error);
}
