import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { attachSocket } from "../socket/attach";
import { socketStateOf } from "../socket/state";
import type { ServerState } from "../../types/server";
import type { WebSocket } from "../../types/ws";
import { trackClient } from "./clients";
import { abortHandshake, selectProtocol, socketAccept } from "./handshake";
import { detachHandshakeError } from "./handshake-error";

const UPGRADED = Symbol("ventijs.upgraded");

/// A transport that already carried one upgrade response.
type UpgradedSocket = Duplex & { readonly [UPGRADED]?: true };

export type UpgradeCallback = (client: WebSocket, request: IncomingMessage) => void;

/// Accepts a validated upgrade: builds the 101 response, instantiates the
/// configured socket class, adopts the stream, and tracks the client.
export function completeUpgrade(
  state: ServerState,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  key: string,
  protocols: readonly string[],
  callback: UpgradeCallback,
): void {
  if (!socket.readable || !socket.writable) {
    socket.destroy();
    return;
  }
  if ((socket as UpgradedSocket)[UPGRADED] === true) {
    throw createError(
      "ERR_INVALID_STATE",
      "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration",
    );
  }
  if (state.lifecycle !== "running") {
    abortHandshake(socket, 503);
    return;
  }
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${socketAccept(key)}`,
  ];
  const SocketClass = state.options.WebSocket ?? state.webSocket;
  const accepted = Reflect.construct(SocketClass, [null, undefined, state.options]) as WebSocket;
  const protocol = selectProtocol(state, protocols, request);
  if (protocol) headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
  emitEvent(state, "headers", headers, request);
  Object.defineProperty(socket, UPGRADED, { value: true });
  detachHandshakeError(socket);
  socket.write(headers.concat("\r\n").join("\r\n"));
  void head;
  // The negotiated values are published before the socket is opened, because opening
  // is what emits `open`, and `ws` has already assigned
  // `_protocol` by the time that event fires. An `open` listener, including an
  // `onopen` attribute or a custom `WebSocket` class, otherwise observed an
  // empty protocol on a connection the server had already selected one for.
  const acceptedState = socketStateOf(accepted);
  if (acceptedState !== undefined && protocol) acceptedState.protocol = protocol;
  if (acceptedState !== undefined)
    acceptedState.closeTimeout = state.normalizedOptions.closeTimeout;
  attachSocket(accepted, socket);
  if (state.normalizedOptions.clientTracking) trackClient(state, accepted);
  callback(accepted, request);
}
