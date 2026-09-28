import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { compare } from "./parity-support";

const REASONS: ReadonlyArray<readonly [string, unknown]> = [
  ["undefined", undefined],
  ["an empty string", ""],
  ["a plain string", "done"],
  ["a Uint8Array", new Uint8Array([0x61, 0x62])],
  ["an empty Uint8Array", new Uint8Array(0)],
  ["an empty array", []],
  ["a number", 42],
  ["an object with no length", {}],
  ["a Float32Array", new Float32Array(20)],
  ["a 124-byte string", "a".repeat(124)],
  // The three rows below are the length-before-type order in `sender.close`. Each measures over
  // the 123-byte cap, so `ws` reports a `RangeError` and never reaches its type dispatch.
  ["a 200-byte Float32Array", new Float32Array(50)],
  ["a 140-byte Uint16Array", new Uint16Array(70)],
  ["a 100 MiB Uint8Array", new Uint8Array(100 * 1024 * 1024)],
  // Over the cap but not over any type's element count, so measurement and type dispatch both refuse it.
  ["a 400-byte Uint8Array", new Uint8Array(400)],
];

/// `ws` is the compatibility contract, so every close reason maps to the same frame or throws the
/// same error and leaves the same state. The typed-array case pins GHSA-58qx-3vcg-4xpx: a
/// `Float32Array` reports fewer elements than its `byteLength`, which `ws` has refused since
/// 8.20.1, and `ws` latches `CLOSING` before it validates, so a refused close still closes.
/// Rows past the cap compare name and message only: Node's `ERR_INVALID_ARG_TYPE` text out of
/// `Buffer.byteLength` is V8's, not a contract ventijs can pin.
test.each(REASONS)(
  "close reason parity for %s",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, reason) => {
    const { expected, actual } = await compare(
      (socket) => {
        socket.close(1000, reason);
      },
      (socket) => {
        socket.close(1000, reason);
      },
    );
    if (expected.threw) expect(actual.threw).toBe(true);
    expect(actual.name).toBe(expected.name);
    if (expected.name !== "TypeError" || expected.message.startsWith("Second argument")) {
      expect(actual.message).toBe(expected.message);
    }
    expect(actual.readyState).toBe(expected.readyState);
  },
);
