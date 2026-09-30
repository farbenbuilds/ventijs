// A close handshake that is never answered.
//
// Its own file because the deadline is the only thing standing between a hung peer
// and a socket that holds its transport and its codec slot for the life of the
// process. `ws` bounds the wait with `closeTimeout`; without it a `close()` on a peer
// that has stopped reading is a promise that is never kept.

import { expect, test } from "vitest";
import { WebSocket, type ClientOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { open, openWithPeer } from "./client-support";
import { rawAcceptServer } from "./raw-peer";

/// `closeTimeout` is accepted at runtime, as `ws` accepts it, and `@types/ws` does not
/// declare it, so a caller in typed code is refused by `ws` too. The cast is what a
/// JavaScript caller does implicitly, and the deadline is the difference between a
/// close that resolves and one that never does.
function withCloseTimeout(milliseconds: number): ClientOptions {
  return { closeTimeout: milliseconds } as ClientOptions;
}

test(
  "a peer that never answers the close is torn down at the deadline",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await rawAcceptServer();
    try {
      const socket = await open(peer.url, undefined, undefined, withCloseTimeout(150));
      const closed = new Promise<number>((resolve) => {
        socket.on("close", resolve);
      });
      socket.close(1000, "bye");
      // The socket is observably CLOSING until the handshake completes or the deadline
      // expires, and the deadline is what makes the second outcome reachable.
      expect(socket.readyState).toBe(WebSocket.CLOSING);
      expect(await closed).toBe(1006);
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await peer.close();
    }
  },
);

test(
  "a peer that answers the close never reaches the deadline",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { socket, harness } = await openWithPeer(
      () => undefined,
      undefined,
      undefined,
      withCloseTimeout(5_000),
    );
    const closed = new Promise<[number, string]>((resolve) => {
      socket.on("close", (code, reason) => resolve([code, reason.toString()]));
    });
    try {
      socket.close(1000, "bye");
      // A peer that answers reports the code the close carried, not the 1006 the
      // deadline would have produced, which is the whole difference the deadline buys.
      const [code, reason] = await closed;
      expect(code).toBe(1000);
      expect(reason).toBe("bye");
    } finally {
      await harness.close();
    }
  },
);

test("a finished socket does not keep a deadline alive", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The deadline is dropped by whichever door finishes the socket, so a socket that
  // closed promptly has nothing left to fire and nothing left to hold the process.
  const { socket, harness } = await openWithPeer(
    () => undefined,
    undefined,
    undefined,
    withCloseTimeout(5_000),
  );
  const closed = new Promise<number>((resolve) => {
    socket.on("close", resolve);
  });
  try {
    socket.close(1000, "bye");
    expect(await closed).toBe(1000);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    await harness.close();
  }
});
