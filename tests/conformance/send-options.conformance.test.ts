// `send`'s options on the wire. `binary` and `fin` were normalized, documented, and never read:
// `send(buffer, { binary: false })` put a binary frame on the wire where `ws` puts text, and
// `send(data, { fin: false })` framed a complete message with `fin` set. The peer is a real `ws`
// client throughout, so every assertion is about how a conforming implementation reads the bytes.

import { expect, test } from "vitest";
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

test("the binary option chooses the opcode", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen = observe(client);
    // Autodetected both ways, then overridden both ways: a Buffer with `binary: false` is a text frame.
    socket.send("abc");
    socket.send("xyz", { binary: true });
    socket.send(Buffer.from("raw"), { binary: false });
    socket.send(Buffer.from("bin"));
    await waitFor(() => seen.length === 4);
    expect(seen).toEqual([
      { text: "abc", binary: false },
      { text: "xyz", binary: true },
      { text: "raw", binary: false },
      { text: "bin", binary: true },
    ]);
  } finally {
    client.terminate();
    await harness.close();
  }
});

/// A caller that fragments has no other way to do it, and RFC 6455 requires the continuation to
/// carry opcode 0: a second opcode-1 frame with `fin` set reads as two complete messages.
test("the fin option fragments an outbound message", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen = observe(client);
    socket.send("one", { fin: false });
    // The peer has no complete message yet, so nothing is delivered at this point.
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual([]);
    socket.send("two", { fin: true });
    await waitFor(() => seen.length === 1);
    // One message, whole, delivered once: the reassembly a peer does with a fragmented send.
    expect(seen).toEqual([{ text: "onetwo", binary: false }]);
  } finally {
    client.terminate();
    await harness.close();
  }
});

/// `fin` defaults to set, so the ordinary send is unchanged.
test("a send with no options is a complete message", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen = observe(client);
    socket.send("one");
    socket.send("two");
    await waitFor(() => seen.length === 2);
    expect(seen.map((entry) => entry.text)).toEqual(["one", "two"]);
  } finally {
    client.terminate();
    await harness.close();
  }
});
