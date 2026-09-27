import type { ClientRequest } from "node:http";
import type { Socket } from "node:net";
import type { NormalizedClientOptions } from "../../types/options";
import type { SocketState } from "../../types/socket";
import type { ClientOptions, WebSocket } from "../../types/ws";
import { normalizeClientOptions } from "../options/client";
import { buildSocketRecord } from "../socket/record";
import { createSocketState } from "../socket/state";
import { thresholdOf } from "../extensions/threshold";
import { parseAddress, type ClientAddress } from "./address";
import { normalizeProtocols, protocolSet, type ProtocolSet } from "./protocols";
import { buildRequest, newKey, type Handshake } from "./request";
import { dial } from "./dial";

export type Attempt = {
  readonly state: SocketState;
  readonly options: NormalizedClientOptions;
  readonly requested: readonly string[];
  readonly offered: ProtocolSet;
  /// The request in flight, or null between hops and after a 101. The guard every
  /// listener checks: a `redirect` hop's `response` arrives after the next hop's
  /// `request` is set, and answering it would abort the hop the client is now on.
  request: ClientRequest | null;
  /// The socket the codec reads, or null until a 101 hands one over.
  ///
  /// Null for the whole handshake now, where it used to be a `net.Socket` from the first
  /// dial: a `CONNECTING` socket held a real connection, and `close()` on it had to
  /// destroy a socket rather than cancel a request.
  transport: Socket | null;
  handshake: Handshake;
  /// The address this attempt is for, which is what a redirect's host and scheme are
  /// compared against: the original one, not the previous hop. A chain that wanders off
  /// `wss:` is refused on the first downgrade, wherever in the chain it happens.
  address: ClientAddress;
  /// The credentials the caller dialled with, kept while a redirect stays on the same
  /// host and dropped the moment it does not. A `Location` names a URL and carries no
  /// credentials, so without this a same-host redirect would silently un-authenticate a
  /// client that authenticated.
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
  // The threshold is known before the handshake, so it is set here; whether the extension
  // was actually negotiated is not, and `open.ts` sets that from the response.
  state.threshold = thresholdOf(normalized.perMessageDeflate);
  const socket = buildSocketRecord(state);
  const attempt: Attempt = {
    state,
    options: normalized,
    requested,
    offered: protocolSet(requested),
    request: null,
    transport: null,
    handshake: buildRequest(parsed, normalized, requested, newKey()),
    address: parsed,
    auth: parsed.auth,
    redirects: 0,
  };
  // Deliberately not attached: the socket's transport and codec are attached when the
  // 101 arrives, because the response is not frames, and a codec that read it would
  // refuse the connection with a 1002 before a single legitimate frame was sent. Until
  // then the socket is `CONNECTING` with no transport, which is what makes `close()` and
  // `terminate()` on a client that has not opened report the aborted handshake the way
  // `ws` does.
  dial(attempt);
  return socket;
}
