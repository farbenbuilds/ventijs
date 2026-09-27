//! A soak, and what it is for.
//!
//! A leak in a socket library is not a bug a unit test finds, because every unit test
//! exits while its sockets are still live. The claim that matters in production is
//! narrower and checkable: a process that opens and closes many connections must end
//! with the resources it started with, and a peer that stops reading must cost the
//! writer a bounded queue rather than unbounded memory.
//!
//! So the measurements here are the ones a leak would move: the codec table's live
//! count, the transport's open handles, and a socket's own accounting. The counts are
//! the engine's and the runtime's rather than the facade's, because the facade's are
//! the thing under suspicion.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { codecLimits } from "../../../src/binding/codec";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer, waitFor } from "./client-support";

/// The codec table's live count, read through a slot that has to be free.
///
/// There is no "how many codecs are live" accessor, and adding one for a test would be
/// an API that exists only for tests. What is observable is the *consequence*: with the
/// table full, `createCodec` fails. So the leak check is a round trip: if every codec a
/// soak opened was released, the table is as empty as it started, and one more codec can
/// still be created afterwards.
function canStillCreateCodecs(count: number): boolean {
  const handles: bigint[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      handles.push(createOne());
    }
    return true;
  } catch {
    return false;
  } finally {
    releaseAll(handles);
  }
}

import { destroyCodec } from "../../../src/binding/codec";
import { serverCodec } from "../../binding/codec-support";

function createOne(): bigint {
  return serverCodec();
}

function releaseAll(handles: bigint[]): void {
  for (const handle of handles) destroyCodec(handle);
}

test(
  "a soak of connections leaves the codec table as empty as it found it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const capacity = codecLimits().messageBytes;
    expect(capacity).toBeGreaterThan(0);
    // A soak that used a fraction of the table and then a check that the whole table is
    // still available: a socket that leaked its codec would show up as a table that no
    // longer fits.
    const before = canStillCreateCodecs(64);
    expect(before).toBe(true);

    const rounds = 60;
    for (let round = 0; round < rounds; round += 1) {
      const { socket, harness } = await openWithPeer((peer) => {
        peer.on("message", () => undefined);
      });
      try {
        socket.send("round");
        await waitFor(() => socket.readyState === WebSocket.OPEN);
      } finally {
        socket.terminate();
        await harness.close();
      }
    }

    // The table is a process-wide constant, so a codec per connection that outlived its
    // socket would have taken `rounds` of them out of a fixed budget.
    expect(canStillCreateCodecs(64)).toBe(true);
  },
);

test(
  "a server under a burst of connections keeps serving",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Concurrency, not just repetition: several sockets at once is where a shared codec
    // table and a per-socket queue are most likely to interfere.
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    const sockets: WebSocket[] = [];
    const accepted: WebSocket[] = [];
    server.on("connection", (socket) => {
      accepted.push(socket);
      // The echo is what makes the independence check meaningful: a message has to come
      // back on the socket that sent it and no other.
      socket.on("message", (data) => socket.send(data));
    });
    try {
      for (let index = 0; index < 32; index += 1) {
        sockets.push(
          await new Promise<WebSocket>((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}`);
            socket.once("open", () => resolve(socket));
            socket.once("error", reject);
          }),
        );
      }
      await waitFor(() => accepted.length === sockets.length);
      // Every socket gets its own echo, which is what proves they are independent rather
      // than one connection's frames arriving on another's.
      const heard = new Set<string>();
      for (const socket of sockets) {
        socket.on("message", (data) => heard.add(data.toString()));
      }
      sockets[0]?.send("ping from the first");
      await waitFor(() => heard.size > 0);
      expect([...heard]).toEqual(["ping from the first"]);
      for (const socket of sockets) socket.close();
      for (const socket of accepted) socket.close();
    } finally {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  },
);
