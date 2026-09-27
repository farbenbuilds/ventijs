//! A handshake that is refused, and a socket that never gets one.
//!
//! Its own file because these are the paths a caller hits when the peer is not a
//! WebSocket server: a plain HTTP server, a closed port. Each has to arrive as a
//! reported failure rather than as a socket that looks open and then never speaks.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

test(
  "a connection to a closed port reports the syscall error",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The `net` error's `code` is what a caller switches on to tell a refused
    // connection from a missing host, so it has to survive the trip.
    const { createServer } = await import("node:net");
    const probe = createServer();
    await new Promise<void>((resolve) => {
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => {
      probe.close(() => resolve());
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const error = await new Promise<Error>((resolve) => {
      socket.on("error", resolve);
    });
    expect((error as NodeJS.ErrnoException).code).toBe("ECONNREFUSED");
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  },
);

test(
  "a refused connection reports the status and closes",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A plain HTTP server is not a WebSocket server, so the handshake is refused and the
    // client has to say why rather than open a socket nothing can speak to.
    const { createServer } = await import("node:http");
    const http = createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => {
      http.listen(0, "127.0.0.1", resolve);
    });
    const port = (http.address() as { port: number }).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    try {
      const events: string[] = [];
      const failure = new Promise<Error>((resolve) => {
        socket.on("error", (error) => {
          events.push("error");
          resolve(error);
        });
      });
      const error = await failure;
      // The status is in the message because `ws` puts it there, and a caller
      // distinguishing "wrong path" from "not a WebSocket server" has nothing else.
      expect(error.message).toContain("404");
      expect(events).toEqual(["error"]);
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
      });
    }
  },
);
