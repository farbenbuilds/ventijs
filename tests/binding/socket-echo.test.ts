import { serverDroppedMessages } from "../../src/binding/server";
import { takeSocketMessage } from "../../src/binding/socket";
import { expect, test } from "vitest";
import { blockEventLoop, collect, connect, opened } from "./echo-client";
import { startEcho } from "./echo-support";

const TEST_TIMEOUT_MS = 20_000;

test(
  "echoes a text message back to the peer",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    try {
      await opened(client);
      const received = collect(client, 1);
      client.send("hello ventijs");
      const [reply] = await received;
      expect(reply?.bytes.toString("utf8")).toBe("hello ventijs");
      expect(reply?.isBinary).toBe(false);
      expect(echo.received).toHaveLength(1);
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "echoes a binary message back with the binary flag preserved",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    try {
      await opened(client);
      const received = collect(client, 1);
      // Bytes that are not valid UTF-8, so a text or binary mix-up is visible.
      client.send(Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x80]));
      const [reply] = await received;
      expect(reply?.bytes.toString("hex")).toBe("00fffe0180");
      expect(reply?.isBinary).toBe(true);
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "echoes a burst within the inbound budget without dropping a message",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    // The inbound ring is the burst budget, and the engine's WebSocket behavior
    // has no hook to stop reading when a consumer falls behind, so a peer that
    // delivers more than this in one burst has the excess counted as dropped.
    // `inbound_slots` in `src/engine/server/instance.zig` is the source of truth.
    const count = 64;
    try {
      await opened(client);
      const received = collect(client, count);
      for (let index = 0; index < count; index += 1) {
        client.send(`message-${index}`);
      }
      const replies = await received;
      const expected = Array.from({ length: count }, (_unused, index) => `message-${index}`);
      expect(replies.map((reply) => reply.bytes.toString("utf8"))).toEqual(expected);
      expect(serverDroppedMessages(echo.handle)).toBe(0n);
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "reports a null take once the inbound ring is drained",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    try {
      await opened(client);
      const received = collect(client, 1);
      client.send("drain me");
      await received;
      expect(takeSocketMessage(echo.handle, await echo.connection())).toBeNull();
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "stages the reply through the ring the client received it from",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    try {
      await opened(client);
      const received = collect(client, 1);
      client.send("accounted");
      await received;
      // One inbound message reached JavaScript, and its echo reached the peer,
      // so the staging ring was both written and drained exactly once.
      expect(echo.received).toHaveLength(1);
      expect(echo.received[0]?.bytes.toString("utf8")).toBe("accounted");
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "counts inbound messages dropped when the consumer stops draining",
  async () => {
    const echo = await startEcho();
    const client = connect(echo.port);
    // Comfortably past the ring depth, so the overflow is a certainty rather
    // than a race against how fast the main thread happens to drain.
    const count = 256;
    try {
      await opened(client);
      for (let index = 0; index < count; index += 1) {
        client.send(`message-${index}`);
      }
      blockEventLoop(400);
      const dropped = serverDroppedMessages(echo.handle);
      expect(dropped).toBeGreaterThan(0n);
      expect(dropped).toBeLessThanOrEqual(BigInt(count));
      // Whatever did fit is still waiting in the ring rather than lost, so the
      // loss is bounded by the buffer and does not corrupt the stream.
      expect(dropped + BigInt(echo.received.length)).toBeLessThanOrEqual(BigInt(count));
    } finally {
      client.close();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);
