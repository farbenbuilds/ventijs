// A leak in a socket library is not a bug a unit test finds, because every unit test exits
// while its sockets are still live. The checkable claim is narrower: a process that opens and
// closes many connections must end with the resources it started with. The counts read are the
// engine's and the runtime's, not the facade's, because the facade's are under suspicion.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { codecLimits } from "../../../src/binding/codec";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer, waitFor } from "./client-support";

/// There is no "how many codecs are live" accessor, and adding one for a test would be a
/// test-only API, so the leak check is a round trip: with the table full, `createCodec` fails.
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
    // A socket that leaked its codec would show up as a table that no longer fits.
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

    // The table is a process-wide constant, so a codec per connection that outlived its socket would have taken `rounds` of them.
    expect(canStillCreateCodecs(64)).toBe(true);
  },
);

test(
  "a server under a burst of connections keeps serving",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Concurrency, not just repetition: several sockets at once is where a shared codec table interferes.
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    const sockets: WebSocket[] = [];
    const accepted: WebSocket[] = [];
    server.on("connection", (socket) => {
      accepted.push(socket);
      // The echo is what makes the independence check meaningful.
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
      // Every socket gets its own echo, which is what proves they are independent.
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
