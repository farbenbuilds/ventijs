// `binaryType`, which decides what a *binary* message looks like to a listener.
//
// It was accepted, stored, and readable back, and then never consulted. Every value
// therefore delivered a `Buffer`, which is the `nodebuffer` answer: a caller who set
// `"arraybuffer"` and compiled cleanly got a `Buffer` with no error and no warning,
// and the mismatch only shows up where the application reads `.byteLength` or
// `.byteOffset` on what it believed was an `ArrayBuffer`.
//
// The peer is a real `ws` client throughout, so the payload bytes are never in
// question -- only what ventiws hands to its own listener.

import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../binding/support";
import {
  nextSocket,
  openClient,
  upgradeHarness,
  waitFor,
} from "../compat/socket/codec-upgrade-support";

test("nodebuffer is the default", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen: Array<{ isBuffer: boolean; isArrayBuffer: boolean }> = [];
    socket.on("message", (data) => {
      seen.push({ isBuffer: Buffer.isBuffer(data), isArrayBuffer: data instanceof ArrayBuffer });
    });
    client.send(Buffer.from([1, 2, 3]));
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ isBuffer: true, isArrayBuffer: false });
  } finally {
    client.terminate();
    await harness.close();
  }
});

test(
  "arraybuffer yields an ArrayBuffer of exactly the message",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const seen: ArrayBuffer[] = [];
      socket.on("message", (data) => {
        if (data instanceof ArrayBuffer) seen.push(data);
      });
      socket.binaryType = "arraybuffer";
      client.send(Buffer.from([1, 2, 3]));
      await waitFor(() => seen.length === 1);
      // Exactly the three bytes, not the 64 KiB the socket read allocated: a caller
      // reading `byteLength` off the underlying allocation would see the whole read.
      expect(seen[0]?.byteLength).toBe(3);
      expect([...new Uint8Array(seen[0] as ArrayBuffer)]).toEqual([1, 2, 3]);
    } finally {
      client.terminate();
      await harness.close();
    }
  },
);
