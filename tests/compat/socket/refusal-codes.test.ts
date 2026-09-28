//! The `WS_ERR_*` codes a malformed frame produces, driven over a real server.
//!
//! These were eleven of the twelve codes `docs/compliance-error-codes.md` called
//! unreachable, and the reason it gave was that a close code is all a caller gets. That
//! was true of the code and not of the data: the codec already classified most of these
//! faults, the classification crossed the boundary, and it was then thrown away. The
//! suite drives real frames because the claim is that the peer and the application now
//! disagree about nothing but the shape of the answer.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { MASK, rawFrame, refused } from "./refusal-support";

/// A masked frame with a reserved bit set, which the encoder will not emit either.
function withReservedBit(bit: number): Buffer {
  const frame = Buffer.from(clientFrames([{ opcode: 0x1, payload: Buffer.from("hi") }]));
  frame[0] = (frame[0] as number) | bit;
  return frame;
}

test("an unmasked frame is WS_ERR_EXPECTED_MASK", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(Buffer.from([0x81, 0x02, 0x68, 0x69]));
  });
  expect(seen.code).toBe("WS_ERR_EXPECTED_MASK");
  expect(seen.ctor).toBe("RangeError");
  expect(seen.message).toBe("Invalid WebSocket frame: MASK must be set");
  expect(seen.closeCode).toBe(1002);
});

test("RSV2 is WS_ERR_UNEXPECTED_RSV_2_3", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(withReservedBit(0x20));
  });
  expect(seen.code).toBe("WS_ERR_UNEXPECTED_RSV_2_3");
  expect(seen.message).toBe("Invalid WebSocket frame: RSV2 and RSV3 must be clear");
  expect(seen.closeCode).toBe(1002);
});

test("RSV3 is WS_ERR_UNEXPECTED_RSV_2_3", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(withReservedBit(0x10));
  });
  expect(seen.code).toBe("WS_ERR_UNEXPECTED_RSV_2_3");
});

test(
  "RSV1 with nothing negotiated is WS_ERR_UNEXPECTED_RSV_1",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(withReservedBit(0x40));
    });
    expect(seen.code).toBe("WS_ERR_UNEXPECTED_RSV_1");
    expect(seen.closeCode).toBe(1002);
  },
);

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

test("a reserved opcode is WS_ERR_INVALID_OPCODE", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(rawFrame([0x83, 0x80 | 1, ...MASK, 0x78]));
  });
  expect(seen.code).toBe("WS_ERR_INVALID_OPCODE");
  expect(seen.closeCode).toBe(1002);
});

test(
  "a continuation with no message in progress is WS_ERR_INVALID_OPCODE",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(rawFrame([0x80, 0x80 | 1, ...MASK, 0x78]));
    });
    expect(seen.code).toBe("WS_ERR_INVALID_OPCODE");
    expect(seen.closeCode).toBe(1002);
  },
);

test(
  "a data frame inside an open message is WS_ERR_INVALID_OPCODE",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(
        clientFrames([
          { opcode: 0x1, payload: Buffer.from("a"), fin: false },
          { opcode: 0x1, payload: Buffer.from("b"), fin: true },
        ]),
      );
    });
    expect(seen.code).toBe("WS_ERR_INVALID_OPCODE");
  },
);
