// Control frames and how a connection on the Node upgrade route ends.
//
// The codes are the whole contract here. A close that never reaches the peer is a
// 1006 to them, a refusal that reports the wrong code is a limit the application
// cannot diagnose, an error with no close leaves a socket open forever, and a ping
// that is not answered on time is a peer that drops the connection.

import { expect, test } from "vitest";
import { OPEN } from "../../../src/compat/ready-state";
import type { ServerOptions } from "../../../src/types/ws";
import { WebSocketServer } from "../../../src/compat/constructors";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, openClient, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// The `maxPayload` the boundary cases below configure.
///
/// `maxPayload` is a per-server option and a per-connection limit, so these tests
/// *set* it rather than relying on whatever the build happens to cap at. That is
/// also the assertion: a 1009 for a message over the configured limit proves the
/// option is enforced, where a 1009 for a message over a compiled constant proves
/// only that the constant exists.
const MAX_PAYLOAD = 64 * 1024;

test(
  "an oversized message is refused with 1009 rather than buffered",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness(serverWith({ maxPayload: MAX_PAYLOAD }));
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
      client.send(Buffer.alloc(MAX_PAYLOAD + 1));
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

test(
  "a fractional close code truncates toward zero on the wire",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const closed = new Promise<[number, string]>((resolve) => {
        client.on("close", (code, reason) => resolve([code, reason.toString()]));
      });
      socket.close(1000.5, "done");
      // `closeCodeOf` truncates before framing, so the peer reads 1000, not 1000.5.
      expect(await closed).toEqual([1000, "done"]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "an absent close reason reaches the peer as a bare close",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const closed = new Promise<[number, string]>((resolve) => {
        client.on("close", (code, reason) => resolve([code, reason.toString()]));
      });
      socket.close(1000, undefined);
      expect(await closed).toEqual([1000, ""]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

/// A `noServer` `WebSocketServer` carrying `options`, for the cases that configure
/// something the other cases leave at the default.
function serverWith(options: ServerOptions): WebSocketServer {
  return new WebSocketServer({ noServer: true, ...options });
}
