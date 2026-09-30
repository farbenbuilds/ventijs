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
import { negotiateExtensions } from "./negotiate";
import { thresholdOf } from "../extensions/threshold";

const UPGRADED = Symbol("ventiws.upgraded");

type UpgradedSocket = Duplex & { readonly [UPGRADED]?: true };

export type UpgradeCallback = (client: WebSocket, request: IncomingMessage) => void;

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
  const negotiation = negotiateExtensions(state, request, socket);
  // The socket may already carry a 400, and a 101 written after it is an
  // `ERR_STREAM_WRITE_AFTER_END` on the caller's own upgrade.
  if (negotiation.outcome === "refused") return;
  const extensions = negotiation.outcome === "accepted" ? negotiation.accepted : null;
  const SocketClass = state.options.WebSocket ?? state.webSocket;
  const accepted = Reflect.construct(SocketClass, [null, undefined, state.options]) as WebSocket;
  const protocol = selectProtocol(state, protocols, request);
  if (protocol) headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
  if (extensions) headers.push(`Sec-WebSocket-Extensions: ${extensions.header}`);
  emitEvent(state, "headers", headers, request);
  Object.defineProperty(socket, UPGRADED, { value: true });
  detachHandshakeError(socket);
  socket.write(headers.concat("\r\n").join("\r\n"));
  // Published before the socket opens, because opening is what emits `open` and `ws` has
  // assigned `_protocol` by then. An `open` listener otherwise saw an empty protocol on a
  // connection the server had already selected one for.
  const acceptedState = socketStateOf(accepted);
  if (acceptedState !== undefined && protocol) acceptedState.protocol = protocol;
  if (acceptedState !== undefined) {
    acceptedState.closeTimeout = state.normalizedOptions.closeTimeout;
    // The server's choice is the socket's on a server socket. Unread, `autoPong: false`
    // was answered anyway: the state default is `true`, so a caller who said "I will
    // answer pings myself" got a pong from the library and a second one of its own.
    acceptedState.autoPong = state.normalizedOptions.autoPong;
    // Per-socket decisions the server already made. `allowSynchronousEvents` normalized
    // and never read meant a caller who set `false` still saw every event on the read
    // that produced it; `skipUTF8Validation` did the same, giving a caller who trusts
    // their own server a hard 1007 on a payload `ws` would have delivered.
    acceptedState.allowSynchronousEvents = state.normalizedOptions.allowSynchronousEvents;
    acceptedState.validateUtf8 = !state.normalizedOptions.skipUTF8Validation;
    // Normalized, reported on `server.options`, and then never read, so the compiled cap
    // decided the real answer. They reach the codec before `attachSocket` opens it,
    // because a codec's limits are fixed at creation.
    acceptedState.maxPayload = state.normalizedOptions.maxPayload;
    acceptedState.maxFragments = state.normalizedOptions.maxFragments;
    acceptedState.maxBufferedChunks = state.normalizedOptions.maxBufferedChunks;
    // The negotiation reaches the codec, not just the header: RSV1 means nothing without
    // it, so a codec built for an uncompressed connection refuses a compressed frame
    // with 1002.
    acceptedState.compressible = extensions !== null;
    if (extensions) acceptedState.extensions = extensions.header;
    acceptedState.threshold = thresholdOf(state.normalizedOptions.perMessageDeflate);
  }
  attachSocket(accepted, socket, undefined, head);
  if (state.normalizedOptions.clientTracking) trackClient(state, accepted);
  callback(accepted, request);
}
