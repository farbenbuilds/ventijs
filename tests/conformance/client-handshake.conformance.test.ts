// The client handshake's failure and refusal paths, compared against `ws`. Every case here
// is a divergence that was silently wrong rather than absent, so each is pinned to `ws`.

import { WebSocket as WsClient } from "ws";
import { expect, test } from "vitest";
import { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { startRawPeer } from "../binding/codec-peer";

/// The `new WebSocket(address, options)` overload. `ws` promotes a non-array object out of
/// the subprotocol slot, so the two arguments must be told apart rather than passed through.
test(
  "the two-argument constructor is the options overload",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await startRawPeer();
    try {
      const socket = new WebSocket(
        `ws://127.0.0.1:${peer.port}/`,
        // The declared shape, not a cast: this is what a TypeScript consumer writes.
        { handshakeTimeout: 5_000 },
      );
      socket.on("error", () => undefined);
      await new Promise<void>((resolve) => {
        socket.once("open", () => resolve());
      });
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    } finally {
      await peer.close();
    }
  },
);

/// The other direction: an options-looking object in a position `ws` treats as protocols is
/// still a protocol list, and is still validated as one.
test("a subprotocol list is not promoted", { timeout: TEST_TIMEOUT_MS }, async () => {
  expect(() => new WebSocket("ws://127.0.0.1:1/", ["chat", "chat"])).toThrowError(
    /invalid or duplicated subprotocol/i,
  );
});

/// RFC 6455 section 7.1.5 assigns 1005, "no status received", to a close frame with an empty
/// body, and `ws` surfaces it. Reporting 1006 instead claimed the transport had failed, a
/// statement about a connection that ended by exactly the agreed handshake.
test("a code-less close reports 1005, not 1006", { timeout: TEST_TIMEOUT_MS }, async () => {
  const peer = await startRawPeer();
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${peer.port}/`);
    socket.on("error", () => undefined);
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });
    const closed = new Promise<{ code: number; reason: Buffer }>((resolve) => {
      socket.once("close", (code: number, reason: Buffer) => resolve({ code, reason }));
    });
    // A close frame with an empty body, which is what `close()` with no argument writes.
    await peer.send(Buffer.from([0x88, 0x00]));
    expect(await closed).toEqual({ code: 1005, reason: Buffer.alloc(0) });
  } finally {
    await peer.close();
  }
});

/// The other half of the same rule: `ws` writes an *empty* close payload for a code-less
/// `close()` and its own peer reports 1005, so substituting 1000 asserted a normal shutdown
/// the caller never stated.
test("close() with no code writes an empty close frame", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { WebSocketServer } = await import("../../src/index");
  const server = new WebSocketServer({ port: 0 });
  const accepted = new Promise<WebSocket>((resolve) => {
    server.on("connection", (socket) => resolve(socket));
  });
  const client = new WsClient(`ws://127.0.0.1:${(server.address() as { port: number }).port}/`);
  client.on("error", () => undefined);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const closed = new Promise<{ code: number; reason: Buffer }>((resolve) => {
    client.once("close", (code: number, reason: Buffer) => resolve({ code, reason }));
  });
  try {
    (await accepted).close();
    expect(await closed).toEqual({ code: 1005, reason: Buffer.alloc(0) });
  } finally {
    client.terminate();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});
