//! The compiled fragment bound, and what a peer exceeding it is closed with.
//!
//! Split from `frame-limits.test.ts` because the fragment bound is a *count* a peer
//! controls, where the other two limits there are a byte total and a boolean. The
//! count needs a fixture of its own: exceeding it means writing sixteen thousand
//! frames, and nothing about that is legible inside a test about UTF-8.

import { expect, test } from "vitest";
import { engineLimits } from "../../../src/binding/server";
import { WebSocketServer, type ServerOptions, type WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// `maxFragments` is accepted at runtime by `ws` and declared by neither it nor
/// `@types/ws`, so a TypeScript caller is refused by both and has to cast.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// The frames a text message split into three pieces, one of which is a two-byte
/// character followed by its continuation.
const SPLIT_TEXT: readonly { opcode: number; payload: Buffer; fin?: boolean }[] = [
  { opcode: 0x1, payload: Buffer.from([0xe2, 0x82]), fin: false },
  { opcode: 0x0, payload: Buffer.from([0xac]), fin: false },
  { opcode: 0x0, payload: Buffer.from("!") },
];

/// A socket with its peer attached, and a way to put frames on the wire by hand.
async function withRawPeer(
  server: WebSocketServer,
  run: (socket: WebSocket, write: (bytes: Buffer) => void) => Promise<void>,
): Promise<void> {
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    // The refusal cases close on purpose, and an `error` with no listener is thrown
    // by Node's policy, so the harness is the one place that listens.
    socket.on("error", () => undefined);
    await run(socket, (bytes) => raw.write(bytes));
  } finally {
    raw.destroy();
    await harness.close();
  }
}

test(
  "a message within the fragment bound is reassembled",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer(atRuntime({ noServer: true, maxFragments: 4 }));
    await withRawPeer(server, async (socket, write) => {
      const seen: string[] = [];
      socket.on("message", (data: Buffer) => seen.push(data.toString()));
      write(clientFrames(SPLIT_TEXT));
      await waitFor(() => seen.length === 1);
      expect(seen[0]).toBe("€!");
    });
  },
);

test(
  "the fragment bound is the compiled one, not the option's",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The option is reported on `server.options` because `ws` reports it, and the bound
    // that is actually applied is the compiled one, so a caller can read what it is
    // competing with rather than guessing.
    const server = new WebSocketServer(atRuntime({ noServer: true }));
    try {
      const options = server.options as unknown as Record<string, unknown>;
      expect(options.maxFragments).toBe(16384);
      expect(engineLimits().maxFragments).toBe(16384);
    } finally {
      server.close();
    }
  },
);

/// `ws` reads `maxFragments` off the connection and closes 1008 when a message is
/// split into more pieces than the limit, which is what the compiled bound does here
/// too. A 1002 would say the frames were malformed, and they were not.
test("too many fragments closes 1008", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  await withRawPeer(server, async (socket, write) => {
    const closed = new Promise<number>((resolve) => {
      socket.on("close", (code: number) => resolve(code));
    });
    // One byte per frame, which is the shape the bound exists for: the reassembly
    // cost is the same either way and the per-frame work is not.
    const limit = engineLimits().maxFragments;
    const pieces = [
      { opcode: 0x2, payload: Buffer.from([0x41]), fin: false },
      ...Array.from({ length: limit }, () => ({
        opcode: 0x0,
        payload: Buffer.from([0x42]),
        fin: false,
      })),
      { opcode: 0x0, payload: Buffer.from([0x43]) },
    ];
    write(clientFrames(pieces));
    expect(await closed).toBe(1008);
  });
});
