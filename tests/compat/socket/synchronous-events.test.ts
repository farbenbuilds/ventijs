// `allowSynchronousEvents`, which decides whether the events a read produces are delivered
// inside that read or on a later tick. The option was normalized, typed, and never read.
// The pause is observable, not just the delay: `ws` stops its parse loop, so a `close` frame
// sitting behind the messages in the same read is not delivered before them.

import { expect, test } from "vitest";
import { WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// The batch of three whole text messages the timing cases share.
const BATCH = clientFrames([
  { opcode: 0x1, payload: Buffer.from("one") },
  { opcode: 0x1, payload: Buffer.from("two") },
  { opcode: 0x1, payload: Buffer.from("three") },
]);

/// A text message and a close in one write; `0x03 0xe8` is 1000, the normal-closure code.
const MESSAGE_THEN_CLOSE = clientFrames([
  { opcode: 0x1, payload: Buffer.from("last") },
  { opcode: 0x8, payload: Buffer.from([0x03, 0xe8]) },
]);

/// `@types/ws` declares this; the cast keeps a suite from testing a different configuration.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// The turn index advances only when this loop advances it, so the question answered is whether the
/// messages *shared* a turn, not how late the transport was. One turn is synchronous, three is deferral.
async function turnsFor(server: WebSocketServer, count: number): Promise<number> {
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const arrivals: number[] = [];
    let turn = 0;
    socket.on("message", () => {
      arrivals.push(turn);
    });
    socket.on("error", () => undefined);
    raw.write(BATCH);
    for (let step = 0; step < 40 && arrivals.length < count; step += 1) {
      turn += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await waitFor(() => arrivals.length === count);
    return new Set(arrivals).size;
  } finally {
    raw.destroy();
    await harness.close();
  }
}

/// The order the application sees a message and the close behind it, for one write.
async function closeOrder(server: WebSocketServer): Promise<string[]> {
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const order: string[] = [];
    socket.on("message", (data: Buffer) => order.push(`message:${data.toString()}`));
    socket.on("close", () => order.push("close"));
    // The refusal cases close on purpose, and an `error` with no listener is thrown by Node's policy.
    socket.on("error", () => undefined);
    raw.write(MESSAGE_THEN_CLOSE);
    await waitFor(() => order.length === 2);
    return order;
  } finally {
    raw.destroy();
    await harness.close();
  }
}

test("the default delivers every message in one turn", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  try {
    // `true` is the default, and the synchronous path is what every existing caller is running.
    expect(await turnsFor(server, 3)).toBe(1);
  } finally {
    server.close();
  }
});

test("false puts each message on its own turn", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer(atRuntime({ noServer: true, allowSynchronousEvents: false }));
  try {
    // The order has to survive: the drain stops at the first deferrable event and resumes next tick.
    expect(await turnsFor(server, 3)).toBe(3);
  } finally {
    server.close();
  }
});

test(
  "a close behind a deferred message still arrives after it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer(
      atRuntime({ noServer: true, allowSynchronousEvents: false }),
    );
    try {
      // A buffered deferral gets this wrong: a `close` in the same read would be dispatched immediately.
      expect(await closeOrder(server)).toEqual(["message:last", "close"]);
    } finally {
      server.close();
    }
  },
);

test("a close is not deferred by default", { timeout: TEST_TIMEOUT_MS }, async () => {
  const server = new WebSocketServer({ noServer: true });
  try {
    // The option is a real choice, not a slower path for everything.
    expect(await closeOrder(server)).toEqual(["message:last", "close"]);
  } finally {
    server.close();
  }
});
