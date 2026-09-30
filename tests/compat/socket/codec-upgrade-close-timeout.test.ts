// The close deadline on a socket the server owns.
//
// Its own file because the server's deadline is a different path from the client's:
// the value comes from the *server's* options rather than from a client's, and a
// socket that never gets it is a socket whose `close()` is a promise nobody keeps.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openRawClient } from "../../binding/codec-net";
import { serve } from "../server/upgrade-support";

test(
  "a server socket with no peer to answer its close is torn down",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A ventiws server, and a raw client that completes the handshake and then never
    // answers a close, which is what a crashed or hung peer looks like on the wire.
    const server = new WebSocketServer({
      noServer: true,
      closeTimeout: 150,
    } as ServerOptions);
    const harness = await serve(server);
    try {
      // The listener before the dial: the raw client's handshake completes inside
      // `openRawClient`, so a `connection` listener attached afterwards has already
      // missed the one event it was waiting for.
      const accepted = new Promise<WebSocket>((resolve) => {
        server.once("connection", resolve);
      });
      const raw = await openRawClient(harness.port);
      const socket = await accepted;
      const closed = new Promise<number>((resolve) => {
        socket.on("close", resolve);
      });
      socket.close(1000, "bye");
      // Observably CLOSING until the deadline expires, which is what makes a close a
      // peer ignores a bounded wait rather than an open-ended one.
      expect(socket.readyState).toBe(WebSocket.CLOSING);
      expect(await closed).toBe(1006);
      expect(socket.readyState).toBe(WebSocket.CLOSED);
      raw.destroy();
    } finally {
      await harness.close();
    }
  },
);

test(
  "a server socket that is answered does not reach the deadline",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The deadline is a fallback, not the path: a peer that answers reports the code
    // the close carried rather than the 1006 the expiry would have produced.
    const server = new WebSocketServer({
      port: 0,
      closeTimeout: 5_000,
    } as ServerOptions);
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const accepted = new Promise<WebSocket>((resolve) => {
      server.once("connection", resolve);
    });
    const client = await new Promise<WebSocket>((resolve, reject) => {
      const peer = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
      peer.once("open", () => resolve(peer));
      peer.once("error", reject);
    });
    try {
      const socket = await accepted;
      const closed = new Promise<[number, string]>((resolve) => {
        socket.on("close", (code, reason) => resolve([code, reason.toString()]));
      });
      socket.close(1000, "bye");
      const [code, reason] = await closed;
      expect(code).toBe(1000);
      expect(reason).toBe("bye");
    } finally {
      client.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  },
);
