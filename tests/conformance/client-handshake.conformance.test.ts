//! The client handshake's failure and refusal paths, compared against `ws`.
//!
//! Every case here is a divergence that was *silently* wrong rather than absent,
//! which is the worst shape for a compatibility library: an application written
//! against ventijs passed its own tests and then spoke a different protocol, or
//! waited for an event that never came. The three that mattered most are in
//! `client-close-events.conformance.test.ts` and `client-refusal.conformance.test.ts`;
//! this file covers the arguments to the handshake itself.

import { WebSocket as WsClient } from "ws";
import { expect, test } from "vitest";
import { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { startRawPeer } from "../binding/codec-peer";

/// The `new WebSocket(address, options)` overload.
///
/// `@types/ws` declares it and `ws` implements it by promoting a non-array object
/// out of the subprotocol slot. Passing the pair through unexamined sent the
/// options object to the subprotocol validator, so a documented, typed, routinely
/// used signature threw a `SyntaxError` about subprotocols on every call.
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

/// A subprotocol list is still a subprotocol list, and still validated as one.
///
/// The promotion reads an object in the second position, so the risk is the other
/// direction: an options-looking object in a position `ws` treats as protocols.
test("a subprotocol list is not promoted", { timeout: TEST_TIMEOUT_MS }, async () => {
  expect(() => new WebSocket("ws://127.0.0.1:1/", ["chat", "chat"])).toThrowError(
    /invalid or duplicated subprotocol/i,
  );
});

/// The `close` code a peer reports for a code-less close frame.
///
/// RFC 6455 section 7.1.5 assigns 1005, "no status received", to a close frame with
/// an empty body, and `ws` surfaces it. Reporting 1006 instead said the transport had
/// failed, which is a claim about a connection that ended by exactly the agreed
/// handshake, and it made 1005 unobservable from a ventijs peer in both directions.
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

/// The close code a `ws` peer reports for a ventijs `close()` with no argument.
///
/// The other half of the same rule. `ws` writes an *empty* close payload for a
/// code-less `close()` and its own peer reports 1005; ventijs substituted 1000, which
/// asserted a normal shutdown the caller never stated and made 1005 invisible to
/// every `ws` client that ever connected.
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
