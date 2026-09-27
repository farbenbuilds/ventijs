//! Control frames and how a connection on the Node upgrade route ends.
//!
//! The codes are the whole contract here. A close that never reaches the peer is a
//! 1006 to them, a refusal that reports the wrong code is a limit the application
//! cannot diagnose, an error with no close leaves a socket open forever, and a ping
//! that is not answered on time is a peer that drops the connection.

import { expect, test } from "vitest";
import { OPEN } from "../../../src/compat/ready-state";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, openClient, upgradeHarness, waitFor } from "./codec-upgrade-support";

test(
  "an oversized message is refused with 1009 rather than buffered",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      // A refused frame is a protocol error, so `ws` emits `error` and then `close`.
      // Both are asserted: a close with no error would hide why the connection ended,
      // and an error with no close would leave the socket open.
      const events: string[] = [];
      socket.on("error", () => events.push("error"));
      const closed = new Promise<number>((resolve) => {
        socket.on("close", (code) => resolve(code));
      });
      client.send(Buffer.alloc(64 * 1024 + 1));
      expect(await closed).toBe(1009);
      expect(events).toEqual(["error"]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a ping is answered with a pong and reported to the socket",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const pings: string[] = [];
      const clientPongs: string[] = [];
      socket.on("ping", (data) => pings.push(data.toString()));
      client.on("pong", (data) => clientPongs.push(data.toString()));

      client.ping("beat");
      // RFC 6455 section 5.5.2 requires the pong promptly and whether or not the
      // application asked for one, so the peer receives it without the socket ever
      // calling `pong`. The socket's own `pong` event is for a pong the *peer* sends,
      // which is the asymmetry `ws` has and this has to match.
      await waitFor(() => pings.length === 1 && clientPongs.length === 1);
      expect(pings[0]).toBe("beat");
      expect(clientPongs[0]).toBe("beat");
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a socket reports OPEN once the upgrade has attached it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      expect((await accepted).readyState).toBe(OPEN);
    } finally {
      client.close();
      await harness.close();
    }
  },
);
