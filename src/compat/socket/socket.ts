import type { ReadyState } from "../../types/close";
import type { BinaryTypeValue } from "../../types/socket";
import type { ClientOptions, ServerOptions, WebSocket } from "../../types/ws";
import { createEmitter } from "../events/emitter";
import { createError } from "../errors";
import {
  addEventListener,
  defineDomAttributes,
  removeEventListener,
  type DomListenerOptions,
} from "../events/dom-listeners";
import { CLOSED, CLOSING, CONNECTING, OPEN } from "../ready-state";
import { closeConnection } from "./lifecycle";
import { terminateConnection } from "./transport";
import { pauseConnection, resumeConnection } from "./gating";
import { controlFrame } from "./control";
import { sendData } from "./send";
import { brandSocket, createSocketState } from "./state";

export { isSocket } from "./state";

/// Every value the setter accepts. One list, so the setter and the record's type
/// cannot disagree about what "binary" means.
const BINARY_TYPE_VALUES: readonly BinaryTypeValue[] = [
  "nodebuffer",
  "arraybuffer",
  "fragments",
  "blob",
];

/// The `ws`-shaped socket record. Client construction is deferred, so a
/// non-null address reports the deferred scope; `null` builds the server-side
/// socket the upgrade path adopts, exactly like `new WebSocket(null)`.
export function createSocket(
  address: string | URL | null,
  protocols?: string | string[],
  options?: ClientOptions | ServerOptions,
): WebSocket {
  if (address !== null) {
    throw createError(
      "ERR_INVALID_STATE",
      "ventijs: client construction is deferred; only server-side sockets are implemented",
    );
  }
  const state = createSocketState();
  void protocols;
  void options;
  const emitter = createEmitter(state);
  const socket = {
    CONNECTING,
    OPEN,
    CLOSING,
    CLOSED,
    // Reports the stored value, including "blob". `@types/ws` narrows the public
    // type to the three Buffer views, and `createSocket` is annotated as
    // returning `WebSocket`, so that narrowing is the vendored contract's rather
    // than this getter's to invent.
    get binaryType(): BinaryTypeValue {
      return state.binaryType;
    },
    set binaryType(value: string) {
      // `ws` accepts "blob" whenever the Blob global exists and silently ignores
      // anything else. `state.binaryType` is typed as the widened union, so this
      // is a narrowing check rather than an assertion that could be wrong.
      const accepted = BINARY_TYPE_VALUES.includes(value as BinaryTypeValue);
      if (!accepted) return;
      state.binaryType = value as BinaryTypeValue;
    },
    get bufferedAmount(): number {
      return state.bufferedAmount;
    },
    get extensions(): string {
      return state.extensions;
    },
    get isPaused(): boolean {
      return state.isPaused;
    },
    get protocol(): string {
      return state.protocol;
    },
    get readyState(): ReadyState {
      return state.readyState;
    },
    get url(): string {
      return state.url;
    },
    ...emitter,
    send: (data: unknown, sendOptions?: unknown, callback?: unknown): void => {
      sendData(state, data, sendOptions, callback);
    },
    ping: (data?: unknown, mask?: unknown, callback?: unknown): void => {
      controlFrame(state, "ping", data, mask, callback);
    },
    pong: (data?: unknown, mask?: unknown, callback?: unknown): void => {
      controlFrame(state, "pong", data, mask, callback);
    },
    close: (code?: unknown, reason?: unknown): void => {
      closeConnection(state, code, reason);
    },
    terminate: (): void => {
      terminateConnection(state);
    },
    pause: (): void => {
      pauseConnection(state);
    },
    resume: (): void => {
      resumeConnection(state);
    },
    addEventListener: (
      type: string,
      handler: unknown,
      listenerOptions?: DomListenerOptions,
    ): void => {
      addEventListener(state, type, handler, listenerOptions);
    },
    removeEventListener: (type: string, handler: unknown): void => {
      removeEventListener(state, type, handler);
    },
  };
  state.target = socket;
  defineDomAttributes(socket, state);
  brandSocket(socket, state);
  return socket as unknown as WebSocket;
}
