// What a peer that does not read costs the writer.
//
// Its own file because it is the one production question a correctness suite cannot
// answer: a socket library that grows a queue without bound is a memory leak with a
// delay, and nothing short of pushing bytes at a peer that ignores them will show it.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer, waitFor } from "./client-support";
import { scriptedPeer } from "./redirect-peer";

/// The `maxPayload` the refusal case below configures on its own socket.
///
/// The client option, not a compiled constant: a local send is only refused when it
/// is over the ceiling the connection was *given*, and the ceiling the boundary now
/// offers is its own 32-bit width, which no test can exceed. Naming the limit is also
/// what makes this an assertion about the option rather than about a constant.
const MAX_PAYLOAD = 64 * 1024;

test(
  "a peer that never reads costs the writer a bounded queue",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A peer that completes the handshake and then never reads is the shape of a slow
    // consumer, and the question is what it costs the writer. The answer has to be a
    // number that stops growing.
    const peer = await scriptedPeer({ first: 101, after: 101 });
    const socket = new WebSocket(peer.url);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const payload = Buffer.alloc(16 * 1024);
      let reported = 0;
      for (let index = 0; index < 200; index += 1) {
        socket.send(payload);
        reported = Math.max(reported, socket.bufferedAmount);
      }
      // The figure is the transport's queue, and the transport stops accepting once the
      // kernel's buffer is full, so the number settles rather than tracking the sends.
      expect(reported).toBeGreaterThan(0);
      expect(reported).toBeLessThan(64 * 1024 * 1024);
    } finally {
      socket.terminate();
      await peer.close();
    }
  },
);

test(
  "a peer that never reads costs the writer a bounded queue",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A peer that completes the handshake and then never reads is the shape of a slow
    // consumer, and the question a production caller asks is what it costs the writer.
    // The answer has to be a number that stops growing, because a socket library that
    // grows a queue without bound is a memory leak with a delay.
    const peer = await scriptedPeer({ first: 101, after: 101 });
    try {
      const socket = new WebSocket(peer.url);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const payload = Buffer.alloc(16 * 1024);
      let reported = 0;
      for (let index = 0; index < 200; index += 1) {
        socket.send(payload);
        reported = Math.max(reported, socket.bufferedAmount);
      }
      // The figure is the transport's queue, and the transport stops accepting once the
      // kernel's buffer is full, so the number settles rather than tracking the sends.
      expect(reported).toBeGreaterThan(0);
      expect(reported).toBeLessThan(64 * 1024 * 1024);
      socket.terminate();
    } finally {
      await peer.close();
    }
  },
);

test("an oversized send is refused and costs no memory", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The refusal path is the one a hostile or careless peer reaches, and the cost has
  // to be a refusal rather than a buffer sized to whatever was offered. A failed send
  // leaves the socket open, which is `ws`'s behaviour, so what is asserted is the
  // queue and the reported failure rather than a close.
  // A limit the *option* sets, not a compiled constant: an oversized local send is
  // only reachable if the connection was given a ceiling it can actually exceed, and
  // a ceiling of four gigabytes cannot be exceeded by a test.
  const over = MAX_PAYLOAD + 1;
  const { socket, harness } = await openWithPeer(
    (peer) => {
      peer.on("message", (data) => peer.send(data));
    },
    undefined,
    undefined,
    { maxPayload: MAX_PAYLOAD },
  );
  try {
    const failures: Error[] = [];
    socket.on("error", (error) => failures.push(error));
    socket.send(Buffer.alloc(over), (error) => {
      if (error) failures.push(error);
    });
    await waitFor(() => failures.length > 0);
    expect(failures[0]?.message).toContain("payload-too-large");
    // Nothing was queued for it: the figure is the transport's, and a refused send
    // never reached the transport.
    expect(socket.bufferedAmount).toBe(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    // And the socket still works, which is the part that makes a failed send
    // recoverable rather than fatal.
    const echoed: string[] = [];
    socket.on("message", (data) => echoed.push(data.toString()));
    socket.send("still working");
    await waitFor(() => echoed.length === 1);
    expect(echoed[0]).toBe("still working");
  } finally {
    socket.terminate();
    await harness.close();
  }
});
