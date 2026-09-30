// `handshakeTimeout` against a peer that accepts and never answers, and the two
// shapes of "no deadline". `ws` gates the option on truthiness (`websocket.js:888`), so
// zero is a caller saying "no deadline" rather than a deadline that expires at once.

import { expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

/// An HTTP server that accepts the connection and says nothing, so the handshake stays
/// open until whatever the client does about it ends the exchange. The accepted sockets
/// are tracked because `server.close()` waits for them, and a connection still open is
/// what these tests deliberately leave behind.
async function silentPeer(): Promise<{ url: string; close: () => Promise<void> }> {
  const open: Socket[] = [];
  const server: Server = createServer((_request, response) => {
    response.on("error", () => undefined);
  });
  server.on("connection", (socket) => {
    open.push(socket);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `ws://127.0.0.1:${port}/`,
    close: () => {
      for (const socket of open) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function firstEvent(socket: WebSocket, withinMs: number): Promise<string> {
  return new Promise((resolve) => {
    socket.once("open", () => resolve("open"));
    socket.once("error", () => resolve("error"));
    setTimeout(() => resolve("timeout"), withinMs);
  });
}

test(
  "a peer that never answers is refused once the deadline passes",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await silentPeer();
    const socket = new WebSocket(peer.url, { handshakeTimeout: 120 });
    try {
      const outcome = await new Promise<string>((resolve) => {
        socket.once("error", (error: Error) => resolve(error.message));
        setTimeout(() => resolve("(no error)"), 1500);
      });
      expect(outcome).toBe("Opening handshake has timed out");
    } finally {
      socket.terminate();
      await peer.close();
    }
  },
);

test(
  "handshakeTimeout: 0 is no deadline rather than a deadline of zero",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The divergence this replaced: the option was read on presence, so zero armed a timer
    // that fired on the next tick and refused a handshake nobody had put a deadline on.
    const peer = await silentPeer();
    const socket = new WebSocket(peer.url, { handshakeTimeout: 0 });
    try {
      expect(await firstEvent(socket, 700)).toBe("timeout");
      expect(socket.readyState).toBe(WebSocket.CONNECTING);
    } finally {
      socket.terminate();
      await peer.close();
    }
  },
);

test("no option at all is also no deadline", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The control for the case above: before the fix both paths refused, so a test that
  // only checked the no-option case would have passed either way.
  const peer = await silentPeer();
  const socket = new WebSocket(peer.url);
  try {
    expect(await firstEvent(socket, 700)).toBe("timeout");
    expect(socket.readyState).toBe(WebSocket.CONNECTING);
  } finally {
    socket.terminate();
    await peer.close();
  }
});
