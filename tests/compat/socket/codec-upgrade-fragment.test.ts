//! Reassembly on the Node upgrade route.
//!
//! Its own file because a split message is the one case where what a peer sends and
//! what the codec does differ: two frames, one message.

import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

test(
  "a fragmented message is reassembled before it is delivered",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    // No `ws` client: a second connection would leave the fragments unread.
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const messages: string[] = [];
      socket.on("message", (data) => messages.push(data.toString()));
      // Written by hand, because `ws`'s `send` starts a new message per call and cannot
      // produce a continuation frame. The codec fixture is the only builder of them.
      raw.write(
        clientFrames([
          { opcode: 0x1, payload: Buffer.from("x".repeat(8_000)), fin: false },
          { opcode: 0x0, payload: Buffer.from("y".repeat(8_000)) },
        ]),
      );
      await waitFor(() => messages.length === 1);
      expect(messages[0]).toBe("x".repeat(8_000) + "y".repeat(8_000));
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);
