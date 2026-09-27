import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { parity } from "./parity-support";

type RefusedClose = readonly [string, unknown, unknown];

const REFUSED_CLOSES: readonly RefusedClose[] = [
  ["a reserved code", 1005, undefined],
  ["a non-numeric code", "1000", undefined],
  ["a non-Uint8Array reason", 1000, new Float32Array(20)],
  ["an oversize reason", 1000, "a".repeat(124)],
];

/// A refused `close` still closes.
///
/// `ws` latches `CLOSING` before it validates, so a close it refuses leaves the
/// socket closing rather than open. Validating first meant every validation throw
/// returned a socket a caller could retry indefinitely, and the divergence was
/// invisible to a comparison that looked only at the error, which is why
/// `tests/compat/socket/close.test.ts` had pinned the wrong state as correct.
test.each(REFUSED_CLOSES)(
  "a refused close latches CLOSING: %s",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, code, reason) => {
    const result = await parity((socket) => {
      socket.close(code, reason);
    });
    expect(result.threw).toBe(true);
  },
);
