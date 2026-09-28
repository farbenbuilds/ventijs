import type {
  CloseEvent,
  ErrorEvent,
  Event as SocketEvent,
  MessageEvent,
  WebSocket,
} from "../../types/ws";

export function createOpenEvent(target: WebSocket): SocketEvent {
  return { type: "open", target };
}

export function createMessageEvent(target: WebSocket, data: WebSocket.Data): MessageEvent {
  return { type: "message", target, data };
}

export function createCloseEvent(
  target: WebSocket,
  code: number,
  reason: Buffer,
  wasClean: boolean,
): CloseEvent {
  return { type: "close", target, code, reason: reason.toString(), wasClean };
}

export function createErrorEvent(target: WebSocket, error: Error): ErrorEvent {
  return { type: "error", target, error, message: error.message };
}

/// An object listener is handed to its `handleEvent` method, matching whatwg semantics.
export function callListener(handler: unknown, target: unknown, event: unknown): void {
  if (typeof handler === "function") {
    Reflect.apply(handler, target, [event]);
    return;
  }
  if (typeof handler === "object" && handler !== null) {
    const handleEvent = (handler as { handleEvent?: unknown }).handleEvent;
    if (typeof handleEvent === "function") {
      Reflect.apply(handleEvent, handler, [event]);
      return;
    }
  }
  throw new TypeError("EventListener must be a function or an object with a handleEvent method");
}
