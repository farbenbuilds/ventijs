import { expect, test } from "vitest";
import { closeFrameWritten } from "../../../src/compat/socket/lifecycle";
import type { WebSocket } from "../../../src/index";
import type { CodedError } from "../../../src/types/errors";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { attached, terminateClient } from "./socket-support";

const MAX_MESSAGE_BYTES = 32 * 1024;

/// The engine route cannot frame an app-initiated close yet: a valid close reports the
/// missing implementation once, writes no frame, and leaves the socket OPEN.
function expectUnsupportedClose(socket: WebSocket, code: number, reason?: unknown): void {
  const errors: CodedError[] = [];
  socket.on("error", (error: Error) => {
    errors.push(error as CodedError);
  });
  socket.close(code, reason as never);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.code).toBe("ERR_POLICY_VIOLATION");
  expect(errors[0]?.message).toMatch(/app-initiated close is not implemented/);
  expect(socket.readyState).toBe(socket.OPEN);
  expect(closeFrameWritten(socket)).toBe(false);
}

test(
  "a fractional close code is validated and then refused as unsupported",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      expectUnsupportedClose(socket, 1000.5);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

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

/// `ws` treats any argument without a truthy `length` as "no reason data", so the close is
/// attempted; the engine route then reports the unsupported close instead of sending a bare
/// frame. `null` is a deliberate divergence: `ws` surfaces a V8-internal `TypeError` there.
test.each([
  ["undefined", undefined],
  ["null", null],
  ["an empty string", ""],
  ["an empty Uint8Array", new Uint8Array(0)],
  ["an empty array", []],
  ["a number", 42],
  ["an object with no length", {}],
])(
  "an absent reason (%s) on the engine route reports the unsupported close",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, reason) => {
    const { server, client, socket } = await attached();
    try {
      expectUnsupportedClose(socket, 1000, reason);
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

/// The ring rejection reaches the socket as an error, and the unsupported close that follows
/// leaves the socket OPEN rather than latching it; the one-way `errorEmitted` latch means the
/// close's own report is not a second event.
test(
  "a refused send reports backpressure and an unsupported close does not latch",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      const failures: CodedError[] = [];
      socket.on("error", (error: Error) => {
        failures.push(error as CodedError);
      });
      for (let index = 0; index < 9; index += 1) {
        socket.send(new Uint8Array(MAX_MESSAGE_BYTES));
      }
      socket.close(1000);
      await new Promise((resolve) => setImmediate(resolve));
      expect(failures.map((error) => error.code)).toEqual(["ERR_BACKPRESSURE"]);
      expect(socket.readyState).toBe(socket.OPEN);
      expect(closeFrameWritten(socket)).toBe(false);
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);
