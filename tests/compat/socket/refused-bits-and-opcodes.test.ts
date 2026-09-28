/// The three reserved bits and the three reserved opcodes, which RFC 6455 leaves
/// undefined and `ws` reports under two codes rather than one.
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

test("RSV2 with RSV1 set is still RSV2", { timeout: TEST_TIMEOUT_MS }, async () => {
  // The three bits are one fault in RFC 6455 and two in `ws`, which checks RSV2 and
  // RSV3 first. A peer that sets both is told about the bit that can never mean anything.
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(withReservedBit(0x40 | 0x20));
  });
  expect(seen.code).toBe("WS_ERR_UNEXPECTED_RSV_2_3");
});

test("a reserved opcode is WS_ERR_INVALID_OPCODE", { timeout: TEST_TIMEOUT_MS }, async () => {
  const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
    send(rawFrame([0x83, 0x80 | 1, ...MASK, 0x78]));
  });
  expect(seen.code).toBe("WS_ERR_INVALID_OPCODE");
  expect(seen.closeCode).toBe(1002);
});

test(
  "a reserved opcode is an invalid opcode whatever else is wrong with it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // 0xB to 0xF are reserved, not control, so a fragmented one or an over-long one is an
    // invalid opcode rather than the fault its other bits name. This is the case `ws`
    // reaches through its opcode switch and the header checks never see.
    for (const first of [0x0b, 0x8b]) {
      const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
        send(rawFrame([first, 0x80 | 1, ...MASK, 0x78]));
      });
      expect(seen.code).toBe("WS_ERR_INVALID_OPCODE");
      expect(seen.closeCode).toBe(1002);
    }
  },
);

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
