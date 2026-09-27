//! `allowSynchronousEvents` on the client, which reads the same option through the
//! same shared path as the server.
//!
//! Split from `synchronous-events.test.ts` for the module budget, and separated by
//! *direction* because the two differ in what can be asserted. The server cases drive
//! a raw peer that can put three frames in one write, which is what the timing
//! assertion needs; a client cannot force that, because whether a peer's writes
//! coalesce into one read is the peer's decision.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// `allowSynchronousEvents` is declared by `@types/ws`; the cast is here so a suite is
/// not quietly testing a different configuration from a real caller's.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// The client reads the same option, from the same shared path.
///
/// The timing itself is not asserted here: it needs the three messages to arrive in
/// one read, and a client cannot force that -- a `ws` server writes one frame per
/// `send`, and whether three writes coalesce into one read is the peer's decision, not
/// a property of this option. What is asserted is the part that is deterministic on
/// this side: the option reaches the client socket, and messages still arrive, in
/// order, through the deferral.
test(
  "the client reads the option and still delivers in order",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true });
    const harness = await upgradeHarness(server);
    // Registered before the dial: the server dispatches `connection` before the client
    // sees `open`, so a listener added after the open would never see it.
    const accepted = nextSocket(server);
    const client = new WebSocket(
      harness.url,
      undefined,
      atRuntime({ allowSynchronousEvents: false }) as never,
    );
    client.on("error", () => undefined);
    await new Promise<void>((resolve) => {
      client.once("open", () => resolve());
    });
    try {
      const socket = await accepted;
      const seen: string[] = [];
      client.on("message", (data: Buffer) => seen.push(data.toString()));
      for (const text of ["one", "two", "three"]) socket.send(text);
      await waitFor(() => seen.length === 3);
      expect(seen).toEqual(["one", "two", "three"]);
    } finally {
      client.terminate();
      await harness.close();
      server.close();
    }
  },
);
