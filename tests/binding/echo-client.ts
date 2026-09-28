import WebSocket from "ws";
import type { Reply } from "./echo-support";

/// Resolves once the peer has completed the handshake, so a test never calls `send()` while
/// the socket is still CONNECTING.
export function opened(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("open", () => {
      resolve();
    });
    client.once("error", reject);
  });
}

/// Resolves with what arrived: `expected` messages, or the peer's close, whichever first.
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

/// A client on the echo server, so a test body is only its specific part.
export function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/`);
}

/// Occupies the main thread so the engine fills the inbound ring undrained. The engine
/// cannot stop reading when its consumer falls behind, so this is the only deterministic
/// way to reach the overflow.
export function blockEventLoop(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Intentionally empty: the point is to not yield.
  }
}
