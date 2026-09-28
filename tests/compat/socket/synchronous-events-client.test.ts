//! `allowSynchronousEvents` on the client, which reads the same option through the same shared
//! path as the server. Separated by *direction* because the two differ in what can be asserted:
//! only the server cases can force three frames into one write.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer, type ServerOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, upgradeHarness, waitFor } from "./codec-upgrade-support";

/// `@types/ws` declares this; the cast keeps a suite from testing a different configuration.
function atRuntime(options: Record<string, unknown>): ServerOptions {
  return options as ServerOptions;
}

/// The timing is not asserted here: it needs three messages in one read, and a `ws` server writes
/// one frame per `send`, so coalescing is the peer's decision. Only the deterministic part is.
test(
  "the client reads the option and still delivers in order",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const server = new WebSocketServer({ noServer: true });
    const harness = await upgradeHarness(server);
    // Registered before the dial: the server dispatches `connection` before the client sees `open`.
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
