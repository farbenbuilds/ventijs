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
  /// Null between hops and after a 101. The guard every listener checks: a `redirect`
  /// hop's `response` arrives after the next hop's request is set, and answering it
  /// would abort the hop the client is now on.
  request: ClientRequest | null;
  /// Null for the whole handshake, where it used to be a `net.Socket` from the first dial:
  /// holding one made `close()` destroy a socket rather than cancel a request.
  transport: Socket | null;
  handshake: Handshake;
  /// The original address, not the previous hop, so a chain that wanders off `wss:` is
  /// refused at its first downgrade wherever that falls.
  address: ClientAddress;
  /// Kept while a redirect stays on the same host and dropped when it does not: a
  /// `Location` carries no credentials, so dropping it silently un-authenticates.
  auth: string | undefined;
  redirects: number;
};

/// Only address and subprotocol normalization can throw: both are programming errors, and
/// by the time anything else fails the caller holds a socket to hear it on.
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
  state.generateMask = normalized.generateMask ?? null;
  state.allowSynchronousEvents = normalized.allowSynchronousEvents;
  state.validateUtf8 = !normalized.skipUTF8Validation;
  state.maxPayload = normalized.maxPayload;
  state.maxFragments = normalized.maxFragments;
  state.maxBufferedChunks = normalized.maxBufferedChunks;
  // Whether the extension was negotiated is not known until the response; `open.ts` sets it.
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
  // Attached on the 101, not before: the response is not frames, and a codec that read it
  // would refuse the connection with a 1002 before a legitimate frame was sent. Until then
  // the socket is `CONNECTING` with no transport, which is what lets `close()` on an
  // unopened client report the aborted handshake the way `ws` does.
  dial(attempt);
  return socket;
}
