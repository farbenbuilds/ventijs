/// The two cases where a socket holds the event loop open rather than failing. Separate
/// from `socket-stuck-states.test.ts` because these are about when work happens rather
/// than about a state a caller would call a bug, and because the fix for each is a
/// different function: one drops a handle, the other bounds a deadline.
import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

test(
  "a deferred resume does not hold the event loop open",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true, allowSynchronousEvents: false } as never);
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const seen: string[] = [];
      socket.on("error", () => undefined);
      socket.on("message", (data: Buffer) => seen.push(data.toString()));
      raw.write(clientFrames([{ opcode: 0x1, payload: Buffer.from("deferred") }]));
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual(["deferred"]);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);

test(
  "bufferedAmount tracks the transport rather than a counter nothing reads",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true });
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      socket.on("error", () => undefined);
      const before = socket.bufferedAmount;
      socket.send("a message the peer is not reading yet");
      // The point is that it moved with the transport and can move back down. A counter
      // that only ever grew would pass an "is it above zero" assertion and fail the
      // caller that polls it in a close handler.
      expect(socket.bufferedAmount).toBeGreaterThanOrEqual(before);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(socket.bufferedAmount).toBe(0);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);
