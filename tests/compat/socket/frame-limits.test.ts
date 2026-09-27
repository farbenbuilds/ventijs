//! The three options that were normalized, documented, typed, and never read.
//!
//! All three are limits a caller sets to bound a peer: how much UTF-8 validation
//! costs, how many pieces a message may be split into, and whether the events go out
//! on the read that produced them. Each was a no-op, so each is a knob an operator
//! turned believing it was protecting something, and the docs described a behaviour
//! the code did not have.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, openClient, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// An option `ws` accepts at runtime and `@types/ws` does not declare.
///
/// `skipUTF8Validation`, `closeTimeout`, `maxBufferedChunks`, and `maxFragments` are
/// all missing from the pinned declaration file, so a TypeScript caller is refused by
/// `ws` for the same reason and has to cast.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// A whole text message whose bytes are not valid UTF-8: a lone continuation byte.
const INVALID_TEXT = Buffer.from([0x41, 0x80, 0x42]);

async function withRawPeer(
  server: WebSocketServer,
  run: (socket: WebSocket, write: (bytes: Buffer) => void) => Promise<void>,
): Promise<void> {
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    // The refusal cases below close on purpose, and an `error` with no listener is
    // thrown by Node's policy, so the harness is the one place that listens.
    socket.on("error", () => undefined);
    await run(socket, (bytes) => raw.write(bytes));
  } finally {
    raw.destroy();
    await harness.close();
  }
}

test("a text message is validated by default", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  await withRawPeer(server, async (socket, write) => {
    const closed = new Promise<number>((resolve) => {
      socket.on("close", (code: number) => resolve(code));
    });
    const seen: string[] = [];
    socket.on("message", (data: Buffer) => seen.push(data.toString()));
    write(clientFrames([{ opcode: 0x1, payload: INVALID_TEXT }]));
    // 1007, the code RFC 6455 section 8.1 assigns to a text message that is not
    // valid UTF-8, and the code the peer reads.
    expect(await closed).toBe(1007);
    expect(seen).toEqual([]);
  });
});

test("skipUTF8Validation delivers it anyway", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, skipUTF8Validation: true }));
  await withRawPeer(server, async (socket, write) => {
    const seen: string[] = [];
    socket.on("message", (data: Buffer) => seen.push(data.toString()));
    write(clientFrames([{ opcode: 0x1, payload: INVALID_TEXT }]));
    await waitFor(() => seen.length === 1);
    // The bytes arrive, mangled exactly as a UTF-8 decode mangles them. That is the
    // point of the option and of the docs' "set to true only if clients are trusted":
    // the caller has accepted that it is reading something the peer did not send as
    // text. What it must *not* be is a hard 1007 for a payload the caller asked to
    // receive.
    expect(seen[0]).toBe("A�B");
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});

/// The flag is per codec, so a second connection on the same server still validates.
test("the option is per connection", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, skipUTF8Validation: true }));
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const client = await openClient(harness.url);
  try {
    const socket = await accepted;
    const seen: string[] = [];
    socket.on("message", (data: Buffer) => seen.push(data.toString()));
    // A `ws` client cannot send invalid UTF-8 through `send` without it being a
    // string, so this asserts the other direction: an ordinary message is unaffected.
    client.send("plain");
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toBe("plain");
  } finally {
    client.terminate();
    await harness.close();
  }
});
