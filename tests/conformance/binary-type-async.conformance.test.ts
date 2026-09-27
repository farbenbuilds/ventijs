//! `binaryType` values that need a `Blob` or a whole message to prove, split from
//! `binary-type.conformance.test.ts` for the module budget.
//!
//! `blob` is asynchronous by construction -- reading one is a promise -- so its case
//! is longer than a Buffer comparison and does not belong inline with the others.

import { expect, test } from "vitest";
import type { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { clientFrames } from "../binding/codec-frames";
import { openRawClient } from "../binding/codec-net";
import {
  nextSocket,
  openClient,
  upgradeHarness,
  waitFor,
} from "../compat/socket/codec-upgrade-support";

test("blob yields a Blob of exactly the message", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen: Blob[] = [];
    socket.on("message", (data) => {
      if (data instanceof Blob) seen.push(data);
    });
    // `"blob"` is narrowed away by `@types/ws`, and by exactly the same widening in
    // `ws`'s own runtime: it accepts the value and delivers a `Blob`, and its
    // declaration says neither. The cast is what a JavaScript caller does implicitly.
    socket.binaryType = "blob" as WebSocket["binaryType"];
    client.send(Buffer.from([4, 5, 6]));
    await waitFor(() => seen.length === 1);
    expect(seen[0]?.size).toBe(3);
    expect([...new Uint8Array(await (seen[0] as Blob).arrayBuffer())]).toEqual([4, 5, 6]);
  } finally {
    client.terminate();
    await harness.close();
  }
});

test("fragments yields the pieces the peer sent", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  // Registered before the dial, because `openRawClient` completes the handshake and
  // the server dispatches `connection` before it resolves.
  const accepted = nextSocket(harness.server);
  // No `ws` client: its `send` starts a new message per call and cannot produce the
  // continuation frame a split needs, so the fragments are written by hand. The
  // codec's own fixture is the one place that builds client frames.
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const seen: Buffer[][] = [];
    socket.on("message", (data) => {
      if (Array.isArray(data)) seen.push(data as Buffer[]);
    });
    socket.binaryType = "fragments";
    // One piece per frame, in one write, which is the case `fragments` is for: the
    // pieces are what arrived and no concatenation of them happened. Only the last
    // frame carries `fin`: a continuation after a finished message is an orphan, and
    // the RFC -- and `zslay` -- refuse it.
    raw.write(
      clientFrames([
        { opcode: 0x2, payload: Buffer.from("aaa"), fin: false },
        { opcode: 0x0, payload: Buffer.from("bb"), fin: false },
        { opcode: 0x0, payload: Buffer.from("c") },
      ]),
    );
    await waitFor(() => seen.length === 1);
    const pieces = seen[0] ?? [];
    expect(pieces.map((piece) => piece.toString())).toEqual(["aaa", "bb", "c"]);
    // Windows into one copy, not three: the point of the value is that the pieces
    // cost no copy beyond the reassembly the codec already did.
    expect(new Set(pieces.map((piece) => piece.buffer)).size).toBe(1);
  } finally {
    raw.destroy();
    await harness.close();
  }
});

test("a message that arrived whole is one fragment", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen: Buffer[][] = [];
    socket.on("message", (data) => {
      if (Array.isArray(data)) seen.push(data as Buffer[]);
    });
    socket.binaryType = "fragments";
    client.send(Buffer.from("whole"));
    await waitFor(() => seen.length === 1);
    expect((seen[0] ?? []).map((piece) => piece.toString())).toEqual(["whole"]);
  } finally {
    client.terminate();
    await harness.close();
  }
});

/// The setting is a live one, as it is in `ws`.
test("binaryType can be changed between messages", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen: string[] = [];
    socket.on("message", (data) => {
      seen.push(
        data instanceof ArrayBuffer ? "arraybuffer" : Array.isArray(data) ? "fragments" : "buffer",
      );
    });
    client.send(Buffer.from([1]));
    await waitFor(() => seen.length === 1);
    socket.binaryType = "arraybuffer";
    client.send(Buffer.from([2]));
    await waitFor(() => seen.length === 2);
    socket.binaryType = "fragments";
    client.send(Buffer.from([3]));
    await waitFor(() => seen.length === 3);
    expect(seen).toEqual(["buffer", "arraybuffer", "fragments"]);
  } finally {
    client.terminate();
    await harness.close();
  }
});
