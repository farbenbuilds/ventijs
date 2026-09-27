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
  // The three rows below are the length-before-type order in `sender.close`.
  // Each measures over the 123-byte cap, so `ws` reports the size as a
  // `RangeError` and never reaches its type dispatch. Checking the type first
  // reported all three as a `TypeError` for being the wrong type, which told a
  // caller reading only the error class that the argument was acceptable.
  ["a 200-byte Float32Array", new Float32Array(50)],
  ["a 140-byte Uint16Array", new Uint16Array(70)],
  ["a 100 MiB Uint8Array", new Uint8Array(100 * 1024 * 1024)],
  // Over the cap but not over any type's element count, so both the measurement
  // and the type dispatch refuse it. Pins that the two checks stay distinct.
  ["a 400-byte Uint8Array", new Uint8Array(400)],
];

/// `ws` is the compatibility contract, so every close reason either maps to the
/// same wire frame or throws the same error and leaves the socket in the same
/// state. The typed-array case pins GHSA-58qx-3vcg-4xpx: a `Float32Array` reports
/// a smaller element count than its `byteLength`, and `ws` has refused it since
/// 8.20.1.
///
/// The state is compared on the throwing path as well. That is the half this table
/// used to skip, and it is where the `close()` latch lives: `ws` latches `CLOSING`
/// before it validates, so a refused close still closes.
///
/// The rows past the cap are compared by error name and message only, because
/// `ws` raises Node's `ERR_INVALID_ARG_TYPE` from `Buffer.byteLength` for a
/// non-measurable argument, and that message is V8's rather than a contract
/// ventijs can pin.
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
