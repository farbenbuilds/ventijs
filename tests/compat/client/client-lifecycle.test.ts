//! How a client connection opens and ends.
//!
//! Its own file because the *order* of events is the contract in every case here. A
//! caller treats `open` as "the connection is live", so anything that can arrive in
//! the same read as the handshake has to be proved to come after it, and a close that
//! never reached the peer is a 1006 to it no matter what the local socket believes.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { open, openWithPeer, wsServer } from "./client-support";

test("a close from the client completes the handshake", { timeout: TEST_TIMEOUT_MS }, async () => {
  const peerCodes: number[] = [];
  const { socket, harness } = await openWithPeer((peer) => {
    peer.on("close", (code: number) => peerCodes.push(code));
  });
  const closed = new Promise<[number, string]>((resolve) => {
    socket.on("close", (code, reason) => resolve([code, reason.toString()]));
  });
  try {
    socket.close(1000, "bye");
    const [code, reason] = await closed;
    expect(code).toBe(1000);
    expect(reason).toBe("bye");
    // The peer saw the frame too, so this is a completed handshake and not a local
    // decision that happened to agree.
    await expectEventually(() => peerCodes.length === 1);
    expect(peerCodes[0]).toBe(1000);
  } finally {
    await harness.close();
  }
});

test(
  "a close from the server is answered by the client",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { harness } = await wsServer((peer) => {
      peer.close(1001, "going away");
    });
    // The peer closes on connection, so the listener has to exist before the socket
    // opens: `open` and `close` are emitted synchronously, and a listener attached
    // afterwards would never see the event it is waiting for.
    const order: string[] = [];
    const closed = new Promise<[number, string]>((resolve) => {
      void open(harness.url, (client) => {
        client.on("open", () => order.push("open"));
        client.on("close", (code, reason) => {
          order.push("close");
          resolve([code, reason.toString()]);
        });
      });
    });
    try {
      const [code, reason] = await closed;
      expect(code).toBe(1001);
      expect(reason).toBe("going away");
      expect(order).toEqual(["open", "close"]);
    } finally {
      await harness.close();
    }
  },
);

test(
  "a refused connection reports the status and closes",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A plain HTTP server is not a WebSocket server, so the handshake is refused and
    // the client has to say why rather than open a socket nothing can speak to.
    const { createServer } = await import("node:http");
    const http = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => {
      http.listen(0, "127.0.0.1", resolve);
    });
    const port = (http.address() as { port: number }).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    try {
      const events: string[] = [];
      const failure = new Promise<Error>((resolve) => {
        socket.on("error", (error) => {
          events.push("error");
          resolve(error);
        });
      });
      const error = await failure;
      // The status is in the message because `ws` puts it there, and a caller
      // distinguishing "wrong path" from "not a WebSocket server" has nothing else.
      expect(error.message).toContain("404");
      expect(events).toEqual(["error"]);
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    }
  },
);

test(
  "terminate closes a connecting socket without waiting for a peer",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { harness } = await wsServer(() => undefined);
    const socket = new WebSocket(harness.url);
    const events: string[] = [];
    const closed = new Promise<number>((resolve) => {
      socket.on("error", () => events.push("error"));
      socket.on("close", resolve);
    });
    try {
      // `terminate` is the one way out that does not need the peer, so a caller whose
      // socket never opened can still release it. `ws` emits `error` first, because
      // the socket was closed before it was established, and reports 1006 because no
      // close frame was exchanged.
      socket.terminate();
      expect(await closed).toBe(1006);
      expect(events).toEqual(["error"]);
    } finally {
      await harness.close();
    }
  },
);

function expectEventually(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TEST_TIMEOUT_MS;
    const poll = (): void => {
      if (condition()) return resolve();
      if (Date.now() > deadline) return reject(new Error("condition unmet within the timeout"));
      setTimeout(poll, 5);
    };
    poll();
  });
}
