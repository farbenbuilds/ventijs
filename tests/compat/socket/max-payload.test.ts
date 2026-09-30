// `maxPayload` and `maxFragments` on the server side of the public surface.
//
// These are the two options that were normalized, reported on `server.options`, and
// then never read: the codec had one compiled capacity and no argument to change it,
// so the answer to "what is the largest message this accepts" was a `comptime`
// constant while the reported value was `ws`'s 100 MiB.
//
// Every case here is small and names the option it set. A test that measured the
// boundary by allocating whatever the build happened to cap at would pass whether or
// not the option was read, which is the failure these replace.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import type { ServerOptions } from "../../../src/types/ws";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, openClient, upgradeHarness } from "./codec-upgrade-support";
/// `maxFragments` is documented and defaulted by `ws` and absent from `@types/ws`, so a
/// typed caller cannot set it without a cast. The cast is here rather than on the
/// option type because the option *is* honoured: this is a gap in the vendored
/// declarations, not a reason to leave it untested.
const FRAGMENT_LIMIT = { maxFragments: 2 } as ServerOptions;

const SMALL = 1024;

test(
  "a message over the server's maxPayload is closed with 1009",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness(
      new WebSocketServer({ noServer: true, maxPayload: SMALL }),
    );
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      // A refused frame is a protocol error, so `error` is emitted and then `close`.
      // Both are asserted: a close with no error hides why the connection ended, and
      // an error with no close leaves the socket open.
      const events: string[] = [];
      socket.on("error", () => events.push("error"));
      const closed = new Promise<number>((resolve) => socket.on("close", resolve));
      client.send(Buffer.alloc(SMALL + 1));
      expect(await closed).toBe(1009);
      expect(events).toEqual(["error"]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a message at the server's maxPayload is delivered whole",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The other half of the boundary above, and the one that catches the mistake in
    // the other direction: an off-by-one that refuses `SMALL` as well as `SMALL + 1`
    // would pass the first case and lose every message at the limit.
    const harness = await upgradeHarness(
      new WebSocketServer({ noServer: true, maxPayload: SMALL }),
    );
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const received = new Promise<number>((resolve) => {
        socket.on("message", (data) => resolve((data as Buffer).length));
      });
      client.send(Buffer.alloc(SMALL, "x"));
      expect(await received).toBe(SMALL);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a message split into more than maxFragments pieces is closed with 1008",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A policy failure rather than a protocol error: the frames were well formed and
    // the peer simply split one message into more pieces than the option allows, which
    // RFC 6455 does not forbid. Four pieces against a bound of two.
    const harness = await upgradeHarness(
      new WebSocketServer({ noServer: true, ...FRAGMENT_LIMIT }),
    );
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      // `error` first, always: an unhandled `error` on an emitter is a thrown
      // exception, and a refusal is expected here rather than a defect.
      socket.on("error", () => undefined);
      const closed = new Promise<number>((resolve) => socket.on("close", resolve));
      for (let piece = 0; piece < 4; piece += 1) {
        client.send("ab", { fin: piece === 3 });
      }
      expect(await closed).toBe(1008);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "two connections in one process carry different maxPayload values",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The property a per-connection ceiling exists for, and the one a single compiled
    // capacity could never have: the limit belongs to the server that was configured,
    // not to the process.
    const strict = await upgradeHarness(new WebSocketServer({ noServer: true, maxPayload: SMALL }));
    const roomy = await upgradeHarness(
      new WebSocketServer({ noServer: true, maxPayload: 8 * SMALL }),
    );
    const strictAccepted = nextSocket(strict.server);
    const roomyAccepted = nextSocket(roomy.server);
    const strictClient = await openClient(strict.url);
    const roomyClient = await openClient(roomy.url);
    try {
      const strictSocket = await strictAccepted;
      const roomySocket = await roomyAccepted;
      strictSocket.on("error", () => undefined);
      const strictClosed = new Promise<number>((resolve) => strictSocket.on("close", resolve));
      const roomyDelivered = new Promise<number>((resolve) => {
        roomySocket.on("message", (data) => resolve((data as Buffer).length));
      });
      const payload = Buffer.alloc(4 * SMALL, "y");
      strictClient.send(payload);
      roomyClient.send(payload);
      expect(await strictClosed).toBe(1009);
      expect(await roomyDelivered).toBe(payload.length);
    } finally {
      strictClient.close();
      roomyClient.close();
      await strict.close();
      await roomy.close();
    }
  },
);
