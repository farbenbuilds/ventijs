//! Choosing this connection's `Sec-WebSocket-Extensions` response.
//!
//! Split out of `handshake.ts` because the decision and the writing of a 101 are two
//! things: a policy failure here is either a 400 on the socket or a `wsClientError`
//! event, and the caller picks which. `handshake.ts` owns the second, this owns the
//! first.
//!
//! The three outcomes are a type rather than a nullable header because two of them end
//! the handshake. A `null` header means "connect uncompressed", which is a normal
//! connection, and a caller that could not tell it apart from a refusal would either
//! have written a 101 down a socket that already had a 400 on it or skipped the header
//! on a connection that should have had one.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ServerState } from "../../types/server";
import { acceptAsServer, type AcceptedDeflate } from "../extensions/deflate";
import { PERMESSAGE_DEFLATE } from "../extensions/negotiated";
import { parseExtensions, type ParsedExtension } from "../extensions/grammar";
import { abortOrEmit } from "./handshake";

export type Negotiation =
  | { readonly outcome: "none" }
  | { readonly outcome: "accepted"; readonly accepted: AcceptedDeflate }
  | { readonly outcome: "refused" };

/// The connection's extension, or why there will not be a connection.
///
/// Two ways to get `none` and they are the same to a caller: the option is off, or the
/// peer did not offer it. RFC 7692 lets either end ignore an extension, and `ws`
/// connects uncompressed in both cases, so a connection with no header is not a
/// degraded connection, it is a normal one.
export function negotiateExtensions(
  state: ServerState,
  request: IncomingMessage,
  socket: Duplex,
): Negotiation {
  const options = state.normalizedOptions.perMessageDeflate;
  if (options === false) return { outcome: "none" };
  const header = request.headers["sec-websocket-extensions"];
  if (header === undefined) return { outcome: "none" };

  let offers: readonly ParsedExtension[];
  try {
    offers =
      parseExtensions(Array.isArray(header) ? header.join(", ") : header).get(PERMESSAGE_DEFLATE) ??
      [];
  } catch {
    abortOrEmit(state, request, socket, 400, "Invalid Sec-WebSocket-Extensions header");
    return { outcome: "refused" };
  }

  const outcome = acceptAsServer(offers, options);
  // A null here is a peer that offered nothing, which is legal and is a plain
  // uncompressed connection.
  if (outcome === null) return { outcome: "none" };
  if ("refusal" in outcome) {
    // `ws` answers a bad or unacceptable extension header with a 400 and this exact
    // message, so the two agree on the bytes as well as on the outcome.
    abortOrEmit(state, request, socket, 400, outcome.refusal);
    return { outcome: "refused" };
  }
  return { outcome: "accepted", accepted: outcome.accepted };
}
