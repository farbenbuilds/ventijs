//! Reassembly on the Node upgrade route.
//!
//! Its own file because a split message is the one case where what a peer sends and
//! what the codec does are two different things: the bytes are two frames and the
//! message is one, and a suite that only ever sent whole frames would not know which
//! of the two it had proved.

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
    // No `ws` client here: a second connection would leave the fragments on a socket
    // nothing is listening to, which is a test that passes by never being read.
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const messages: string[] = [];
      socket.on("message", (data) => messages.push(data.toString()));
      // A fragmented message written by hand, because `ws`'s `send` starts a new
      // message per call and cannot produce the continuation frame a split needs. The
      // codec's own fixture is the one place that builds client frames, so it is the
      // one place that may build them here.
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
