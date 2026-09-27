import type { ReadyState } from "../../types/close";
import type { BinaryTypeValue } from "../../types/socket";
import type { WebSocket } from "../../types/ws";
import { createEmitter } from "../events/emitter";
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
import { bufferedAmountOf } from "./payload";
import { sendData } from "./send";
import type { SocketState } from "../../types/socket";
import { brandSocket } from "./state";

/// Every value the setter accepts. One list, so the setter and the record's type
/// cannot disagree about what "binary" means.
const BINARY_TYPE_VALUES: readonly BinaryTypeValue[] = [
  "nodebuffer",
  "arraybuffer",
  "fragments",
  "blob",
];

/// The `ws`-shaped socket record, built around a state the caller has filled in.
///
/// Separate from construction because the two paths reach it differently: the server
/// path adopts a state and hands it over, and the client path fills a state in while
/// the handshake is still running. The record itself is identical, so the methods,
/// the DOM attributes, and the listener registry are defined once rather than once
/// per direction, which is what keeps the two sockets interchangeable to a caller.
export function buildSocketRecord(state: SocketState): WebSocket {
  const emitter = createEmitter(state);
  const socket = {
    CONNECTING,
    OPEN,
    CLOSING,
    CLOSED,
    // Reports the stored value, including "blob". `@types/ws` narrows the public
    // type to the three Buffer views, and `createSocket` is annotated as
    // returning `WebSocket`, so that narrowing is the vendored contract's rather than
    // this getter's to invent.
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
      // Read live rather than returning the cached count: the number a caller polls to
      // decide whether to stop sending changes as the queue drains, without any send
      // happening to refresh it. Which queue depends on the route, so the choice lives
      // in one function rather than in this getter.
      return bufferedAmountOf(state);
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
