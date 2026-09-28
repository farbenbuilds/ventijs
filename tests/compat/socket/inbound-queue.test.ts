/// The inbound read queue behind a paused parse, which is what `maxBufferedChunks` bounds.
/// Separate from `synchronous-events.test.ts` because that file pins the *timing* of a
/// deferred delivery; this one pins that nothing is lost while the pause holds, and the
/// loss it was written for was silent: a read arriving mid-pause was discarded with no
/// `error`, no `close`, and no counter, so a peer outrunning the application lost messages.
import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { socketStateOf } from "../../../src/compat/socket/state";
import type { CodedError } from "../../../src/types/errors";
import { ingest } from "../../../src/compat/socket/codec-inbound";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// One message per `write`, so each read carries a single frame and the queue has to hold
/// the reads between ticks rather than a tail inside one of them.
function framed(count: number): Buffer {
  return clientFrames(
    Array.from({ length: count }, (_unused, index) => ({
      opcode: 0x1,
      payload: Buffer.from(`m${index}`),
    })),
  );
}

test(
  "a read arriving during a deferred delivery is delivered, not discarded",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({
      noServer: true,
      allowSynchronousEvents: false,
    } as never);
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const seen: string[] = [];
      socket.on("error", () => undefined);
      socket.on("message", (data: Buffer) => seen.push(data.toString()));
      raw.write(framed(1));
      await waitFor(() => seen.length === 1);
      // The pause holds from here until the next tick, so these land behind it.
      raw.write(framed(9));
      await waitFor(() => seen.length === 10);
      expect(seen).toEqual(["m0", "m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);

test(
  "one message per write across many ticks loses nothing",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({
      noServer: true,
      allowSynchronousEvents: false,
    } as never);
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const seen: string[] = [];
      socket.on("error", () => undefined);
      socket.on("message", (data: Buffer) => seen.push(data.toString()));
      for (let index = 0; index < 12; index += 1) {
        raw.write(framed(1));
        // A yield per message, which is what puts a read inside the next tick's pause.
        await new Promise((resolve) => setImmediate(resolve));
      }
      await waitFor(() => seen.length === 12);
      expect(seen).toHaveLength(12);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);

test(
  "the queue refuses the connection at maxBufferedChunks, as ws does",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A bound of two, reached by driving the queue directly: over a socket the reads
    // coalesce and the pause drains one per tick, so the bound is only reachable by a
    // caller that queues faster than it drains. `ws` refuses at the same bound with the
    // same code from `Receiver.prototype._write`, which counts the same reads.
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const state = socketStateOf(socket);
      expect(state).toBeDefined();
      if (state === undefined) return;
      socket.on("error", () => undefined);
      const failure = new Promise<CodedError>((resolve) => socket.once("error", resolve));
      // A parse pause held open, which is the only state in which a read is queued.
      state.deliveryPaused = true;
      state.maxBufferedChunks = 2;
      state.pendingInput.push(Buffer.alloc(0), Buffer.alloc(0));
      ingest(state, framed(1));
      const error = await failure;
      expect(error.code).toBe("WS_ERR_TOO_MANY_BUFFERED_PARTS");
      expect(state.pendingInput).toHaveLength(2);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);
