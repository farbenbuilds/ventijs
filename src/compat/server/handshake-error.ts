import type { Duplex } from "node:stream";

/// The socket error handler that belongs to the handshake phase.
///
/// `handleUpgrade` attaches one before it validates anything, because a socket
/// that fails during the handshake has to be destroyed rather than leaked, and
/// `completeUpgrade` removes it once the 101 is written: from that point the
/// adopted socket owns its own error handling, and a leftover handler that only
/// destroys would race the terminal latch and discard the close code.
///
/// It is a per-socket closure rather than one shared function so the reference
/// stored on the socket is the reference `removeListener` matches. A shared
/// function would need `this` to find its socket, which the repository's
/// anti-OOP rule bans, and a structurally equal replacement would not be removed
/// at all.
const HANDSHAKE_ERROR = Symbol("ventijs.handshakeError");

type HandshakeSocket = Duplex & { [HANDSHAKE_ERROR]?: () => void };

export function attachHandshakeError(socket: Duplex): void {
  const handler = (): void => {
    socket.destroy();
  };
  (socket as HandshakeSocket)[HANDSHAKE_ERROR] = handler;
  socket.on("error", handler);
}

export function detachHandshakeError(socket: Duplex): void {
  const record = socket as HandshakeSocket;
  const handler = record[HANDSHAKE_ERROR];
  if (handler === undefined) return;
  socket.removeListener("error", handler);
  delete record[HANDSHAKE_ERROR];
}
