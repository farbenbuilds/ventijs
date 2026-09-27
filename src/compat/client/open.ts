import { CODEC_ROLE } from "../../binding/codec";
import type { WebSocket } from "../../types/ws";
import { attachSocket } from "../socket/attach";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { extensionsRejection, parseResponse, rejection } from "./response";
import { abort, type Attempt } from "./connect";

/// Checks a complete response, then either opens the socket or refuses it.
///
/// Every field of a 101 is checked rather than the status alone, because a server
/// that is not a WebSocket server can answer 101 to anything: a wrong `Upgrade`
/// means the peer upgraded to something else, and a wrong accept digest means the
/// response belongs to a different request.
export function respond(attempt: Attempt, bytes: Buffer): void {
  // A caller that closed or terminated the socket while the handshake was in flight
  // has already been told the socket is gone, and the transport it was waiting for is
  // still open. Attaching now would open a codec, emit `open` on a closed socket, and
  // leave a connection nothing will ever read.
  if (attempt.state.readyState === CLOSED) {
    attempt.transport.destroy();
    return;
  }
  const response = parseResponse(bytes);
  const refused = rejection(response, attempt.handshake, attempt.offered);
  if (refused !== null) {
    abort(attempt, createError("ERR_PROTOCOL", refused));
    return;
  }
  const extensions = extensionsRejection(response, attempt.options.perMessageDeflate !== false);
  if (extensions !== null) {
    abort(attempt, createError("ERR_PROTOCOL", extensions));
    return;
  }
  const state = attempt.state;
  state.protocol = response.headers["sec-websocket-protocol"] ?? "";
  state.extensions = response.headers["sec-websocket-extensions"] ?? "";
  // The timeout was the handshake's, not the connection's: `ws` leaves an open socket
  // with no read deadline, and a caller that wants one sets it itself.
  attempt.transport.setTimeout(0);
  // Attached here rather than before the request, because the codec must not see the
  // response: it reads the upgrade response as a frame and refuses the connection
  // with a 1002 before a single legitimate frame was sent.
  const socket: WebSocket | null = (state.target as WebSocket | undefined) ?? null;
  if (socket === null) {
    abort(attempt, createError("ERR_INVALID_STATE", "ventijs: the socket record is missing"));
    return;
  }
  // `rest` is what followed the response head, so a frame that shared the read with
  // the 101 reaches the codec, and it does so after `open` because `attachSocket`
  // owns that order.
  attachSocket(socket, attempt.transport, CODEC_ROLE.client, response.rest);
}
