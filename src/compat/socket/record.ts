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

/// One list, so the setter and the record's type cannot disagree about "binary".
const BINARY_TYPE_VALUES: readonly BinaryTypeValue[] = [
  "nodebuffer",
  "arraybuffer",
  "fragments",
  "blob",
];

/// The `ws`-shaped socket record, built around a state the caller has filled in. The
/// server path adopts a state and the client path fills one in mid-handshake, so the
/// record is defined once rather than once per direction.
export function buildSocketRecord(state: SocketState): WebSocket {
  const emitter = createEmitter(state);
  const socket = {
    CONNECTING,
    OPEN,
    CLOSING,
    CLOSED,
    // Reports the stored value, including "blob": `@types/ws` narrows the public type
    // to three Buffer views, and that narrowing is the vendored contract's.
    get binaryType(): BinaryTypeValue {
      return state.binaryType;
    },
    set binaryType(value: string) {
      // `ws` accepts "blob" wherever the Blob global exists and silently ignores
      // anything else, so this is a narrowing check, not an assertion that could be wrong.
      const accepted = BINARY_TYPE_VALUES.includes(value as BinaryTypeValue);
      if (!accepted) return;
      state.binaryType = value as BinaryTypeValue;
    },
    get bufferedAmount(): number {
      // Read live: the number a caller polls to decide whether to stop sending changes
      // as the queue drains, with no send to refresh it. Which queue depends on the
      // route, so the choice lives in one function.
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
