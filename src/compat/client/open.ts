/// A 101: report it, then decide whether it is a usable connection.
///
/// **The order is `ws`'s and it is load-bearing.** `ws` emits `upgrade` with the
/// `IncomingMessage` *before* it checks anything, and a listener is allowed to close or
/// terminate the socket there. A caller that saw the 101 and closed has answered the
/// question the event exists to answer, and continuing to validate would attach a codec
/// and emit `open` on a socket it just closed.
///
/// Every field of a 101 is then checked rather than the status alone, because a server
/// that is not a WebSocket server can answer 101 to anything: a wrong `Upgrade` means
/// the peer upgraded to something else, and a wrong accept digest means the response
/// belongs to a different request.

import { CODEC_ROLE } from "../../binding/codec";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { WebSocket } from "../../types/ws";
import { attachSocket } from "../socket/attach";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED } from "../ready-state";
import { acceptExtension } from "./extension";
import { protocolRejection } from "./protocols";
import { expectedAccept } from "./request";
import { abort, discard } from "./dial";
import type { Attempt } from "./connect";

export function onUpgrade(
  attempt: Attempt,
  response: IncomingMessage,
  socket: Socket,
  head: Buffer,
): void {
  const { state } = attempt;
  // This socket is ours from here, and every path out of this function may destroy it
  // while a read is in flight. A socket that reports an error with no listener is an
  // uncaught exception in the caller's process, and the read that reports it is the one
  // the peer was in the middle of when it went away -- which is most of them.
  socket.on("error", () => undefined);
  emitEvent(state, "upgrade", response);
  if (state.readyState === CLOSED) {
    discard(socket);
    return;
  }
  const refused = reject(response, attempt);
  if (refused !== null) {
    abort(attempt, createError("ERR_PROTOCOL", refused));
    return;
  }
  const extension = acceptExtension(response, attempt.options.perMessageDeflate);
  if ("refusal" in extension) {
    abort(attempt, createError("ERR_PROTOCOL", extension.refusal));
    return;
  }
  state.protocol = response.headers["sec-websocket-protocol"] ?? "";
  state.extensions = response.headers["sec-websocket-extensions"] ?? "";
  // Set before `attachSocket` below, because the codec reads it there: a codec built for
  // an uncompressed connection refuses a compressed frame with 1002, so a negotiation
  // that only reached the header would break the first message.
  state.compressible = extension.accepted !== null;
  // The timeout was the handshake's, not the connection's: `ws` leaves an open socket
  // with no read deadline, and a caller who wants one sets it itself.
  socket.setTimeout(0);
  const target: WebSocket | null = (state.target as WebSocket | undefined) ?? null;
  if (target === null) {
    abort(attempt, createError("ERR_INVALID_STATE", "ventijs: the socket record is missing"));
    return;
  }
  // `head` is what followed the response head, so a frame that shared the read with the
  // 101 reaches the codec, and it does so after `open` because `attachSocket` owns that
  // order.
  attempt.transport = socket;
  // The handshake is over, so `close()` has a transport to destroy from here on and the
  // hook would only be able to abort a request that has already been superseded.
  state.cancelHandshake = null;
  attachSocket(target, socket, CODEC_ROLE.client, head);
}

/// Why a 101 is not a usable connection, or null when it is.
function reject(response: IncomingMessage, attempt: Attempt): string | null {
  const upgrade = response.headers.upgrade;
  if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
    return "Invalid Upgrade header";
  }
  if (response.headers["sec-websocket-accept"] !== expectedAccept(attempt.handshake.key)) {
    return "Invalid Sec-WebSocket-Accept header";
  }
  return protocolRejection(response.headers["sec-websocket-protocol"], attempt.offered);
}
