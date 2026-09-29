import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { parity } from "./parity-support";

/// RFC 6455 §5.5 caps a control frame at 125 bytes, and `ws` refuses an oversize
/// payload with a `RangeError` thrown synchronously from `sender.ping`. The check
/// belongs in the facade because it is a caller error that has to be reported the
/// same way whether or not a control frame can be staged yet, and without it a
/// staged control frame becomes an RFC violation the moment the transport lands.
test.each([
  ["a 126-byte payload", 126],
  ["a large payload", 200],
])("ping refuses %s", { timeout: TEST_TIMEOUT_MS }, async (_name, length) => {
  const result = await parity((socket) => {
    socket.ping(new Uint8Array(length));
  });
  expect(result.threw).toBe(true);
});

test("pong refuses an oversize payload", { timeout: TEST_TIMEOUT_MS }, async () => {
  const result = await parity((socket) => {
    socket.pong(new Uint8Array(126));
  });
  expect(result.threw).toBe(true);
});

/// The cap is exactly RFC 6455's, not off by one. `ws` accepts 125 bytes and
/// ventiws must not refuse it either; the two then diverge for a different
/// reason, the missing control-frame transport, which this check is not about.
test("ping accepts a payload of exactly 125 bytes", { timeout: TEST_TIMEOUT_MS }, async () => {
  const result = await parity((socket) => {
    socket.ping(new Uint8Array(125));
  });
  expect(result.threw).toBe(false);
});
