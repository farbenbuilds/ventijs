//! The `WS_ERR_*` codes a payload produces, driven over a real server.
//!
//! The framing half is in `refusal-codes.test.ts`. These are the ones where the fault is
//! in the bytes or in the policy rather than in the header, and the two where the close
//! code and the error code are easy to confuse: a size limit and a fragment limit are
//! both 1000-series policy close codes, and `ws` gives each its own string.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { engineLimits } from "../../../src/binding/server";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness } from "./codec-upgrade-support";
import { MASK, rawFrame, refused } from "./refusal-support";

test(
  "invalid UTF-8 is a plain Error carrying WS_ERR_INVALID_UTF8",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(clientFrames([{ opcode: 0x1, payload: Buffer.from([0x41, 0x80, 0x42]) }]));
    });
    // `ws` raises an `Error` here, not a `RangeError`, and the difference is visible to a
    // caller catching by type.
    expect(seen.code).toBe("WS_ERR_INVALID_UTF8");
    expect(seen.ctor).toBe("Error");
    expect(seen.message).toBe("Invalid WebSocket frame: invalid UTF-8 sequence");
    expect(seen.closeCode).toBe(1007);
  },
);

test(
  "a close payload with a reserved code is WS_ERR_INVALID_CLOSE_CODE",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(rawFrame([0x88, 0x80 | 2, ...MASK, 0x03, 0xee]));
    });
    expect(seen.code).toBe("WS_ERR_INVALID_CLOSE_CODE");
    expect(seen.closeCode).toBe(1002);
  },
);

test(
  "a close payload one byte long is an invalid control payload length",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      send(rawFrame([0x88, 0x80 | 1, ...MASK, 0x03]));
    });
    expect(seen.code).toBe("WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH");
    expect(seen.closeCode).toBe(1002);
  },
);

test(
  "too many fragments is WS_ERR_TOO_MANY_BUFFERED_PARTS",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const seen = await refused(new WebSocketServer({ noServer: true }), (send) => {
      const limit = engineLimits().maxFragments;
      send(
        clientFrames([
          { opcode: 0x1, payload: Buffer.from([0x41]), fin: false },
          ...Array.from({ length: limit }, () => ({
            opcode: 0x0,
            payload: Buffer.from([0x42]),
            fin: false,
          })),
          { opcode: 0x0, payload: Buffer.from([0x43]) },
        ]),
      );
    });
    expect(seen.code).toBe("WS_ERR_TOO_MANY_BUFFERED_PARTS");
    expect(seen.message).toBe("Too many message fragments");
    // 1008, not 1002: every frame was well formed and the peer simply split one message
    // into more pieces than the option allows.
    expect(seen.closeCode).toBe(1008);
  },
);

test(
  "a message over maxPayload is WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true, maxPayload: 8 });
    const seen = await refused(server, (send) => {
      send(clientFrames([{ opcode: 0x1, payload: Buffer.from("0123456789") }]));
    });
    expect(seen.code).toBe("WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
    expect(seen.message).toBe("Max payload size exceeded");
    expect(seen.closeCode).toBe(1009);
  },
);

test("a second refused frame is not reported twice", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness();
  const accepted = nextSocket(harness.server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const errors: string[] = [];
    socket.on("error", (error: Error & { code?: string }) => errors.push(error.code ?? ""));
    const closed = new Promise<number>((resolve) => {
      socket.on("close", (code: number) => resolve(code));
    });
    raw.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    raw.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(await closed).toBe(1002);
    // One refused frame ends the connection, and the latched reason is reported once
    // rather than once per frame. That is the whole reason the reason is an ordinal
    // rather than a string built per frame.
    expect(errors).toEqual(["WS_ERR_EXPECTED_MASK"]);
  } finally {
    raw.destroy();
    await harness.close();
  }
});
