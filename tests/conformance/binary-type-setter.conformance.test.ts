// `binaryType` read back, and the values that are not what the caller asked for.
//
// Split from `binary-type.conformance.test.ts` because both assert on the getter
// rather than on what a listener receives.

import { expect, test } from "vitest";
import { WebSocketServer, type WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { openClient, upgradeHarness } from "../compat/socket/codec-upgrade-support";

/// An unrecognised value is ignored, as `ws` ignores it.
test("an unknown binaryType is ignored", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  const harness = await upgradeHarness(server);
  const accepted = new Promise<WebSocket>((resolve) => {
    server.once("connection", resolve);
  });
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    socket.binaryType = "nodebuffer";
    // Out of type on purpose: `ws` ignores an unrecognised value rather than throwing.
    socket.binaryType = "nonsense" as WebSocket["binaryType"];
    expect(socket.binaryType).toBe("nodebuffer");
  } finally {
    client.terminate();
    await harness.close();
    server.close();
  }
});
