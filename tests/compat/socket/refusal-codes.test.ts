/// The masking and control-frame `WS_ERR_*` codes, driven over a real server. The
/// reserved bits and opcodes are in `refused-bits-and-opcodes.test.ts`.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { MASK, rawFrame, refused } from "./refusal-support";

test("an unmasked frame is WS_ERR_EXPECTED_MASK", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(Buffer.from([0x81, 0x02, 0x68, 0x69]));
  });
  expect(seen.code).toBe("WS_ERR_EXPECTED_MASK");
  expect(seen.ctor).toBe("RangeError");
  expect(seen.message).toBe("Invalid WebSocket frame: MASK must be set");
  expect(seen.closeCode).toBe(1002);
});

test(
  "a fragmented control frame is WS_ERR_EXPECTED_FIN",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(rawFrame([0x09, 0x80 | 1, ...MASK, 0x78]));
    });
    expect(seen.code).toBe("WS_ERR_EXPECTED_FIN");
    expect(seen.message).toBe("Invalid WebSocket frame: FIN must be set");
    expect(seen.closeCode).toBe(1002);
  },
);

test(
  "a control frame over 125 bytes is WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(
        rawFrame([
          0x89,
          0x80 | 126,
          0x00,
          0x7e,
          ...MASK,
          ...Array.from({ length: 126 }, () => 0x78),
        ]),
      );
    });
    expect(seen.code).toBe("WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
    expect(seen.closeCode).toBe(1002);
  },
);
