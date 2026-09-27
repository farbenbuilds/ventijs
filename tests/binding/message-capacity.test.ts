import { expect, test } from "vitest";
import { engineLimits, serverDroppedMessages } from "../../src/binding/server";
import { collect, connect, opened } from "./echo-client";
import { startEcho } from "./echo-support";

const TEST_TIMEOUT_MS = 30_000;

/// The payloads Autobahn group 1 puts on the wire, and the ones its report blames
/// the message cap for.
///
/// The fuzzing client sends 65535- and 65536-byte payloads in `1.1.6`-`1.1.8` and
/// `1.2.6`-`1.2.8` and expects a clean echo. At the previous 32 KiB cap the engine
/// closed all six with 1009, which is a correct answer to a cap the suite never
/// agreed to, so they were recorded as six failures rather than as a suite that
/// had not been run.
///
/// The suite itself can only be recorded on a host with the digest-pinned fuzzing
/// client, which is a frozen Python 2.7 image and so needs Docker. This file is the
/// half that does not: it puts the same two payload sizes on the wire through a
/// real `ws` peer and asserts the echo came back whole. A cap regression fails here,
/// on any host, in seconds.
const SUITE_PAYLOAD_SIZES = [65_535, 65_536];

test(
  "the compiled cap is above the largest payload the conformance suite sends",
  () => {
    // The assertion that makes the rest of this file mean something: if the cap
    // ever drops back below 65536, the two round trips below would still pass
    // while the suite still failed, and the file would be quietly wrong.
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
        // The two sizes straddle the seven-bit length field's widest boundary: one
        // is a two-byte extended length and the next is an eight-byte one, so a
        // helper that only knew the 126 encoding would pass one and fail the
        // other.
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
