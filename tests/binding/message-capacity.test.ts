import { expect, test } from "vitest";
import { engineLimits, serverDroppedMessages } from "../../src/binding/server";
import { collect, connect, opened } from "./echo-client";
import { startEcho } from "./echo-support";

const TEST_TIMEOUT_MS = 30_000;

/// The payloads Autobahn group 1 puts on the wire, and the ones its report blames the cap for.
/// The client sends 65535- and 65536-byte payloads in `1.1.6`-`1.1.8` and `1.2.6`-`1.2.8`; at the
/// old 32 KiB cap the engine closed all six with 1009. Recording the suite needs Docker, so this
/// is the half that does not: the same two sizes over a real `ws` peer.
const SUITE_PAYLOAD_SIZES = [65_535, 65_536];

test(
  "the compiled cap is above the largest payload the conformance suite sends",
  () => {
    // If the cap ever drops below 65536, the two round trips below would still pass while the suite still failed.
    const cap = engineLimits().messageBytes;
    expect(cap).toBeGreaterThanOrEqual(Math.max(...SUITE_PAYLOAD_SIZES));
  },
  TEST_TIMEOUT_MS,
);

for (const size of SUITE_PAYLOAD_SIZES) {
  test(
    `round trips a ${size}-byte ${size === 65_535 ? "text" : "binary"} message`,
    async () => {
      const echo = await startEcho();
      const client = connect(echo.port);
      try {
        await opened(client);
        const received = collect(client, 1);
        // The two sizes straddle the widest boundary of the seven-bit length field: 65535 is a
        // two-byte extended length and 65536 an eight-byte one.
        const payload = Buffer.alloc(size, "a");
        client.send(size === 65_535 ? payload.toString("latin1") : payload);
        const [reply] = await received;
        expect(reply?.bytes.length).toBe(size);
        expect(reply?.isBinary).toBe(size !== 65_535);
        expect(serverDroppedMessages(echo.handle)).toBe(0n);
      } finally {
        client.close();
        await echo.dispose();
      }
    },
    TEST_TIMEOUT_MS,
  );
}
