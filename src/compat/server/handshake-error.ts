import type { Duplex } from "node:stream";

/// The socket error handler that belongs to the handshake phase. `handleUpgrade` attaches one
/// before validating anything, because a socket failing mid-handshake must be destroyed rather
/// than leaked; `completeUpgrade` removes it after the 101, so no leftover handler that only
/// destroys can race the terminal latch and discard the close code. A per-socket closure, so
/// the reference stored on the socket is the one `removeListener` matches: a shared function
/// would need `this` to find its socket, which the anti-OOP rule bans.
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
