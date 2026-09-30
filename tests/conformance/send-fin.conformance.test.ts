// `send`'s `fin` option, from the client, and across a multi-byte character.
//
// Split from `send-options.conformance.test.ts` for the module budget, and separated
// by *direction* rather than by length. The framing decision is shared code, so the
// only thing that can regress these two independently is the client; one file per
// direction is what makes that visible.

import { expect, test } from "vitest";
import { WebSocket } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import {
  nextSocket,
  openClient,
  upgradeHarness,
  waitFor,
} from "../compat/socket/codec-upgrade-support";

type Observed = { readonly text: string; readonly binary: boolean };

function observe(target: {
  on: (event: "message", handler: (data: Buffer, isBinary: boolean) => void) => void;
}): Observed[] {
  const seen: Observed[] = [];
  target.on("message", (data, isBinary) => seen.push({ text: data.toString(), binary: isBinary }));
  return seen;
}

/// A fragment boundary in the middle of a multi-byte character still reassembles.
///
/// The bytes are concatenated before the UTF-8 check, so splitting a character across
/// frames is legal. A codec that validated each frame on its own would refuse this
/// with 1007, and a caller would have no way to fragment a multi-byte payload at all.
/// Splitting a *string* on a byte boundary is not expressible, which is why this sends
/// the two halves as buffers: the payload is binary by autodetection, and the point is
/// the bytes, not the opcode.
test(
  "a fragment boundary inside a character still reassembles",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const seen = observe(client);
      const whole = Buffer.from("héllo", "utf8");
      // The two-byte `é` starts at index 1 and ends at index 3, so the split lands
      // inside it.
      socket.send(whole.subarray(0, 2), { fin: false });
      socket.send(whole.subarray(2), { fin: true });
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual([{ text: "héllo", binary: true }]);
    } finally {
      client.terminate();
      await harness.close();
    }
  },
);

/// The client reads the same two options, from the same shared path.
test("the client honours both options too", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = new WebSocket(harness.url);
  client.on("error", () => undefined);
  await new Promise<void>((resolve) => {
    client.once("open", () => resolve());
  });
  try {
    const socket = await accepted;
    const seen = observe(socket);
    client.send(Buffer.from("raw"), { binary: false });
    client.send("a", { fin: false });
    client.send("b", { fin: true });
    await waitFor(() => seen.length === 2);
    expect(seen).toEqual([
      { text: "raw", binary: false },
      { text: "ab", binary: false },
    ]);
  } finally {
    client.terminate();
    await harness.close();
  }
});
