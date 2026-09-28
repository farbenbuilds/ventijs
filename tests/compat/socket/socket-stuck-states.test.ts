//! The states a socket can reach that a caller would call a bug.
//!
//! Each of these was reachable and each failed quietly: a transport that cannot be
//! written left a socket `OPEN` for ever, a listener that threw left the codec holding
//! half a frame with the undecoded tail lost, and a deferred resume held the event loop
//! open for a turn. None of them is a `ws` behaviour, because `ws` has no equivalent
//! state to get into.

import { Duplex } from "node:stream";
import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { attachSocket } from "../../../src/compat/socket/attach";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// A transport that is already gone, which is what a peer that disappears between the
/// upgrade and the adoption hands over. Node reports it as neither readable nor
/// writable, and the server's own upgrade path checks for exactly that.
function deadStream(): Duplex {
  const stream = new Duplex({
    read: () => undefined,
    write: (_chunk, _encoding, callback) => callback(null),
  });
  stream.destroy();
  return stream;
}

test(
  "a transport that is already gone is not adopted as a connection",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    try {
      const socket = new WebSocket("ws://example.invalid/");
      socket.on("error", () => undefined);
      attachSocket(socket, deadStream());
      // A socket that reported `OPEN` here would accept sends, report them successful,
      // and keep `bufferedAmount` at zero for the life of the process. It stays
      // `CONNECTING` because nothing ever opened it, which is what a caller sees when
      // the upgrade completed and the connection did not.
      expect(socket.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      await harness.close();
    }
  },
);

test(
  "a listener that throws ends the connection instead of corrupting it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true });
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      socket.on("error", () => undefined);
      const closed = new Promise<number>((resolve) => {
        socket.on("close", (code: number) => resolve(code));
      });
      // The throw leaves the transport's `data` callback, so it arrives as an
      // uncaughtException. It has to keep arriving: a handler that swallows its own
      // bug is a harder thing to debug than one that crashes the request.
      const escaped = new Promise<Error>((resolve) => {
        process.once("uncaughtException", resolve);
      });
      socket.on("message", () => {
        throw new Error("the application's own bug");
      });
      raw.write(clientFrames([{ opcode: 0x1, payload: Buffer.from("first") }]));
      // The tail of this read is the codec's, not ours, and a throw used to lose it: the
      // next read would start a fresh frame in the middle of one and deliver a garbled
      // message or refuse the connection for a fault the peer never committed.
      expect((await escaped).message).toBe("the application's own bug");
      expect(await closed).toBe(1006);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);

test(
  "a deferred resume does not hold the event loop open",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true, allowSynchronousEvents: false } as never);
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const seen: string[] = [];
      socket.on("error", () => undefined);
      socket.on("message", (data: Buffer) => seen.push(data.toString()));
      raw.write(clientFrames([{ opcode: 0x1, payload: Buffer.from("deferred") }]));
      await waitFor(() => seen.length === 1);
      expect(seen).toEqual(["deferred"]);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);

test(
  "bufferedAmount tracks the transport rather than a counter nothing reads",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true });
    const harness = await upgradeHarness(server);
    const accepted = nextSocket(server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      socket.on("error", () => undefined);
      const before = socket.bufferedAmount;
      socket.send("a message the peer is not reading yet");
      // The point is that it moved with the transport and can move back down. A counter
      // that only ever grew would pass an "is it above zero" assertion and fail the
      // caller that polls it in a close handler.
      expect(socket.bufferedAmount).toBeGreaterThanOrEqual(before);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(socket.bufferedAmount).toBe(0);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);
