/// Choosing this connection's `Sec-WebSocket-Extensions` response. The three outcomes are
/// a type rather than a nullable header because two of them end the handshake, and a
/// caller that could not tell a refusal from "connect uncompressed" would either write a
/// 101 down a socket that already had a 400 on it, or skip a header it should have sent.

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

/// Two ways to get `none`, and they are the same to a caller: the option is off, or the
/// peer did not offer it. RFC 7692 lets either end ignore an extension, and `ws` connects
/// uncompressed in both cases, so a connection with no header is a normal one.
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
  // A null is a peer that offered nothing, which is legal.
  if (outcome === null) return { outcome: "none" };
  if ("refusal" in outcome) {
    // `ws` answers a bad or unacceptable header with a 400 and this exact message.
    abortOrEmit(state, request, socket, 400, outcome.refusal);
    return { outcome: "refused" };
  }
  return { outcome: "accepted", accepted: outcome.accepted };
}
