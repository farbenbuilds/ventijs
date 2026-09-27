import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { attached, terminateClient } from "./socket-support";

const MAX_MESSAGE_BYTES = 32 * 1024;

test("fractional close codes truncate like ws", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { server, client, socket } = await attached();
  try {
    expect(() => socket.close(1000.5)).not.toThrow();
    expect(socket.readyState).toBe(socket.CLOSING);
  } finally {
    terminateClient(client);
    await server.dispose();
  }
});

/// Pins GHSA-58qx-3vcg-4xpx. A `Float32Array` reports an element count smaller
/// than its `byteLength`, so accepting it as a close reason would size a frame
/// from bytes that are never written. `ws` refuses the argument since 8.20.1.
///
/// The socket is left `CLOSING`, not `OPEN`: `ws` latches the state before it
/// validates, so a close it refuses still closes. Leaving it `OPEN` meant a
/// refused close could be retried indefinitely, which a caller cannot tell apart
/// from a close that was never attempted.
test(
  "a typed array that is not a Uint8Array is refused as a close reason",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      expect(() => socket.close(1000, new Float32Array(20) as never)).toThrow(
        "Second argument must be a string or a Uint8Array",
      );
      expect(socket.readyState).toBe(socket.CLOSING);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

/// `ws` treats any argument without a truthy `length` as "no reason data", so
/// these still produce a bare close frame instead of being refused. `null` is a
/// deliberate divergence: `ws` surfaces a V8-internal `TypeError` there.
test.each([
  ["undefined", undefined],
  ["null", null],
  ["an empty string", ""],
  ["an empty Uint8Array", new Uint8Array(0)],
  ["an empty array", []],
  ["a number", 42],
  ["an object with no length", {}],
])(
  "an absent reason (%s) still sends a bare close frame",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, reason) => {
    const { server, client, socket } = await attached();
    try {
      expect(() => socket.close(1000, reason as never)).not.toThrow();
      expect(socket.readyState).toBe(socket.CLOSING);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

/// A 124-byte reason exceeds the 123-byte control-frame budget, so it must be
/// refused before any frame is staged. The state still latches to `CLOSING`,
/// because `ws` latches before it validates.
test("an oversize close reason is refused", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { server, client, socket } = await attached();
  try {
    expect(() => socket.close(1000, "a".repeat(124))).toThrow(RangeError);
    expect(socket.readyState).toBe(socket.CLOSING);
  } finally {
    terminateClient(client);
    await server.dispose();
  }
});

test(
  "a close rejected by the ring surfaces an error and latches",
  {
    timeout: TEST_TIMEOUT_MS,
  },
  async () => {
    const { server, client, socket } = await attached();
    try {
      const failures: Error[] = [];
      socket.on("error", (error) => {
        failures.push(error);
      });
      for (let index = 0; index < 9; index += 1) {
        socket.send(new Uint8Array(MAX_MESSAGE_BYTES));
      }
      socket.close(1000);
      await new Promise((resolve) => setImmediate(resolve));
      expect(failures.map((error) => (error as { code?: string }).code)).toEqual([
        "ERR_BACKPRESSURE",
      ]);
      expect(socket.readyState).toBe(socket.CLOSED);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);
