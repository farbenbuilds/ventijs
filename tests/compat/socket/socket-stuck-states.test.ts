// The states a socket can reach that a caller would call a bug, and the teardown a
// thrown listener is owed. The event-loop cases are in `socket-event-loop.test.ts`.
// None of these is a `ws` behaviour, because `ws` has no equivalent state to get into.

import { Duplex } from "node:stream";
import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { clientFrames } from "../../binding/codec-frames";
import { openRawClient } from "../../binding/codec-net";
import { attachSocket } from "../../../src/compat/socket/attach";
import { socketStateOf } from "../../../src/compat/socket/state";
import { nextSocket, upgradeHarness } from "./codec-upgrade-support";

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
      // The listener is attached *after* the call, which is the natural order: a caller
      // cannot know a socket will fail before it hands it a transport. Emitting
      // synchronously here would latch the error with nobody to receive it and Node
      // would rethrow it as an uncaught exception rather than a socket failing.
      attachSocket(socket, deadStream());
      const outcome = new Promise<string>((resolve) => {
        socket.on("error", (error: Error & { code?: string }) => resolve(error.code ?? "ERR_NONE"));
        socket.on("close", () => resolve("CLOSED_WITHOUT_ERROR"));
      });
      // A socket left `CONNECTING` here never moves again, so a caller awaiting `open`
      // or `close` waits for the life of the process. `ws` reports this handshake
      // failure as ERR_INVALID_STATE, which is the code used here for the same thing.
      expect(await outcome).toBe("ERR_INVALID_STATE");
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await harness.close();
    }
  },
);

test(
  "a throwing listener still releases the codec slot",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The teardown after `failConnection` has to run even when the application's own
    // listener throws, or every connection that dies this way leaks a codec slot and the
    // table fills after a bounded number of them. A `message` listener is what reaches
    // that path: a `close` is emitted from a transport event that releases the codec on
    // its own. The throw then leaves `driveInbound` and reaches the process, which is
    // the application's business, so it is absorbed here rather than asserted.
    const uncaught: string[] = [];
    const swallow = (error: unknown): void => void uncaught.push((error as Error).message);
    process.on("uncaughtException", swallow);
    const harness = await upgradeHarness();
    try {
      const accepted = nextSocket(harness.server);
      const raw = await openRawClient(harness.port);
      const socket = await accepted;
      const state = socketStateOf(socket);
      socket.on("message", () => {
        throw new Error("the application's own failure");
      });
      const drained = new Promise<number>((resolve) => {
        socket.on("close", (code: number) => resolve(code));
      });
      raw.write(clientFrames([{ opcode: 0x1, payload: Buffer.from("hi") }]));
      expect(await drained).toBe(1006);
      expect(uncaught).toEqual(["the application's own failure"]);
      // A codec left behind here is a `bigint` handle rather than null, and the next
      // connection to fail the same way takes another slot until the table is full.
      expect(state?.codec).toBeNull();
    } finally {
      process.off("uncaughtException", swallow);
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
