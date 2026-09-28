import type { SocketEventMap, SocketState } from "../../types/socket";
import {
  DEFAULT_CLOSE_TIMEOUT,
  DEFAULT_MAX_BUFFERED_CHUNKS,
  DEFAULT_MAX_FRAGMENTS,
  DEFAULT_MAX_PAYLOAD,
} from "../options/shared";
import { createRegistry } from "../events/registry";
import { CONNECTING } from "../ready-state";

const SOCKET_BRAND = Symbol("ventijs.socket");
const SOCKET_STATE = Symbol("ventijs.socket.state");

type BrandedSocket = {
  [SOCKET_BRAND]?: true;
  [SOCKET_STATE]?: SocketState;
};

export function brandSocket(socket: object, state: SocketState): void {
  Object.defineProperties(socket, {
    [SOCKET_BRAND]: { value: true },
    [SOCKET_STATE]: { value: state },
  });
}

export function isSocket(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as BrandedSocket)[SOCKET_BRAND] === true;
}

export function socketStateOf(socket: unknown): SocketState | undefined {
  if (typeof socket !== "object" || socket === null) return undefined;
  return (socket as BrandedSocket)[SOCKET_STATE];
}

/// Defaults mirror `ws`: a server-side socket starts CONNECTING with the abnormal close
/// code latched until a close frame or the transport supplies a better one.
export function createSocketState(): SocketState {
  return {
    url: "",
    protocol: "",
    extensions: "",
    binaryType: "nodebuffer",
    readyState: CONNECTING,
    isPaused: false,
    isServer: true,
    closeCode: 1006,
    closeReason: Buffer.alloc(0),
    closeFrameSent: false,
    closeFrameReceived: false,
    fragmentsOpen: false,
    errorEmitted: false,
    attachment: null,
    transport: null,
    codec: null,
    closeTimer: null,
    closeTimeout: DEFAULT_CLOSE_TIMEOUT,
    allowSynchronousEvents: true,
    deliveryPaused: false,
    pendingInput: [],
    maxBufferedChunks: DEFAULT_MAX_BUFFERED_CHUNKS,
    validateUtf8: true,
    maxPayload: DEFAULT_MAX_PAYLOAD,
    maxFragments: DEFAULT_MAX_FRAGMENTS,
    cancelHandshake: null,
    compressible: false,
    threshold: 0,
    autoPong: true,
    generateMask: null,
    maskScratch: Buffer.alloc(4),
    listeners: createRegistry<SocketEventMap>(),
    maxListeners: 10,
    warned: new Set<string>(),
    target: undefined,
  };
}
