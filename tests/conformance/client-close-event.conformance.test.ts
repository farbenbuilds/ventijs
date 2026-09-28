//! Every way a client handshake can fail, observed the way a caller observes it. The abort path
//! latched `CLOSED` and then called the function that dispatches `close`, which returns
//! immediately on a socket that is already there, so every pre-101 failure set the ready state
//! and emitted no event. Existing tests missed it by asserting `readyState`, which was correct.

import { WebSocket as WsClient } from "ws";
import { expect, test } from "vitest";
import { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";

/// What a caller awaiting a refused handshake sees.
type Observed = {
  readonly errors: number;
  readonly closed: boolean;
  readonly stateDuringError: number;
  readonly code: number;
};

async function refused(dial: () => Promise<WebSocket>): Promise<Observed> {
  const errors: Error[] = [];
  let stateDuringError = -1;
  let closed = false;
  let code = 0;
  const socket = await dial();
  socket.on("error", () => {
    errors.push(new Error("failed"));
    stateDuringError = socket.readyState;
  });
  const finished = new Promise<void>((resolve) => {
    socket.on("close", (closeCode: number) => {
      code = closeCode;
      closed = true;
      resolve();
    });
  });
  await Promise.race([finished, new Promise<void>((resolve) => setTimeout(resolve, 250))]);
  return { errors: errors.length, closed, stateDuringError, code };
}

test(
  "a refused connection reports error and then close",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Nothing is listening, so the kernel refuses the dial: the ordinary first-run failure.
    const port = await closedPort();
    const result = await refused(async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
      socket.on("error", () => undefined);
      return socket;
    });
    expect(result.errors).toBe(1);
    expect(result.closed).toBe(true);
    expect(result.code).toBe(1006);
    // `ws` latches `CLOSING` before the error, so a listener sees a socket going away, not gone.
    expect(result.stateDuringError).toBe(WebSocket.CLOSING);
  },
);

test(
  "a handshake that is answered with a non-101 reports error and then close",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // No `unexpected-response` listener, so nothing takes the refusal over and the client aborts.
    const { createServer } = await import("node:http");
    const http = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => {
      http.listen(0, "127.0.0.1", resolve);
    });
    const { port } = http.address() as { port: number };
    try {
      const result = await refused(async () => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        socket.on("error", () => undefined);
        return socket;
      });
      expect(result.errors).toBe(1);
      expect(result.closed).toBe(true);
      expect(result.code).toBe(1006);
      expect(result.stateDuringError).toBe(WebSocket.CLOSING);
    } finally {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    }
  },
);

test(
  "a ws client sees the same two events on the same failures",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The ready state during `error` is the only part a caller reads that tells "failing" from "failed".
    const port = await closedPort();
    const result = await refused(async () => {
      const socket = new WsClient(`ws://127.0.0.1:${port}/`) as unknown as WebSocket;
      socket.on("error", () => undefined);
      return socket;
    });
    expect(result.errors).toBe(1);
    expect(result.closed).toBe(true);
    expect(result.code).toBe(1006);
    expect(result.stateDuringError).toBe(2);
  },
);

/// A port nothing is listening on, obtained by binding one and letting it go.
async function closedPort(): Promise<number> {
  const { createServer } = await import("node:net");
  const probe = createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address() as { port: number };
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
}
