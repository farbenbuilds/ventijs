//! The `WS_ERR_*` codes a *payload* produces, driven over a real server. The framing
//! half is in `refusal-codes.test.ts` and the close-payload half in
//! `refused-close-payload.test.ts`. These are the faults in the bytes rather than the
//! header, and the two where the close code and the error code are easy to confuse: a
//! size limit and a fragment limit are both 1000-series policy close codes, and `ws`
//! gives each its own string.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { nextSocket, upgradeHarness } from "./codec-upgrade-support";
import { deflateServer, WS_OFFER } from "./deflate-support";
import { offerExtension } from "./raw-peer";
import { MASK, rawFrame, refused } from "./refusal-support";

test(
  "a payload that is not a DEFLATE stream is ERR_INVALID_COMPRESSED_DATA",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // RSV1 with the extension negotiated, then bytes that cannot be inflate input. `ws`
    // reports the zlib error with no code, so choosing between its two codes here is a
    // decision: WS_ERR_INVALID_UTF8 would send a caller looking at the text, which is not
    // what is wrong. The offer is what a default `ws` client makes, and without a
    // negotiated extension RSV1 is refused before the payload is ever inflated.
    const harness = await upgradeHarness(deflateServer());
    const accepted = nextSocket(harness.server);
    const handshake = await offerExtension(harness.port, WS_OFFER);
    try {
      expect(handshake.status).toBe(101);
      const raw = handshake.socket;
      const socket = await accepted;
      const seen = new Promise<{ code: string; closeCode: number }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("no refusal within the timeout")),
          TEST_TIMEOUT_MS,
        );
        socket.on("error", (error: Error & { code?: string }) => {
          clearTimeout(timer);
          socket.on("close", (closeCode: number) => {
            resolve({ code: error.code ?? "ERR_NONE", closeCode });
          });
        });
      });
      raw.write(
        rawFrame([0xc1, 0x80 | 8, ...MASK, 0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa, 0xf9, 0xf8, 0xf7]),
      );
      expect(await seen).toEqual({ code: "ERR_INVALID_COMPRESSED_DATA", closeCode: 1007 });
    } finally {
      await harness.close();
    }
  },
);

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
