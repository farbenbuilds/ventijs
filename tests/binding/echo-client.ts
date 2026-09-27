import WebSocket from "ws";
import type { Reply } from "./echo-support";

/// Resolves once the peer has completed the handshake, so a test never calls
/// `send()` while the socket is still CONNECTING.
export function opened(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("open", () => {
      resolve();
    });
    client.once("error", reject);
  });
}

/// Collects what the client receives, resolving once `expected` messages have
/// arrived, or when the peer has closed, whichever comes first.
export function collect(client: WebSocket, expected: number): Promise<Reply[]> {
  return new Promise((resolve, reject) => {
    const received: Reply[] = [];
    client.on("message", (bytes: Buffer, isBinary: boolean) => {
      received.push({ bytes, isBinary });
      if (received.length === expected) resolve(received);
    });
    client.on("error", reject);
    client.on("close", () => {
      resolve(received);
    });
  });
}

/// Opens a client against the echo server, so a test body is only the part that
/// is specific to it.
export function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/`);
}

/// Holds the event loop so the engine thread can fill the inbound ring without
/// the Node main thread draining it. The engine has no hook to stop reading a
/// socket when its consumer falls behind, so occupying this side is the only
/// way to reach the overflow deterministically instead of racing the scheduler.
export function blockEventLoop(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Intentionally empty: the point is to not yield.
  }
}
