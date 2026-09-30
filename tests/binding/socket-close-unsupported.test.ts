// The engine route's close path before the engine-thread drain exists. `closeSocket`
// refuses an app-initiated close, so the facade must report the missing implementation
// once, leave the socket OPEN, and keep both directions working.

import { expect, test } from "vitest";
import WebSocket from "ws";
import { packConnectionHandle } from "../../src/binding/handle";
import { takeSocketMessage } from "../../src/binding/socket";
import { attachNativeSocket } from "../../src/compat/socket/attach";
import { closeFrameWritten } from "../../src/compat/socket/lifecycle";
import { OPEN } from "../../src/compat/ready-state";
import { WebSocket as VentiwsSocket } from "../../src/index";
import type { CodedError } from "../../src/types/errors";
import { startAndWait, TEST_TIMEOUT_MS } from "./support";

test(
  "an unsupported engine-route close reports once, stays OPEN, and leaves the socket usable",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, port } = await startAndWait({ host: "127.0.0.1", port: 0 });
    const client = new WebSocket(`ws://127.0.0.1:${port}/`);
    client.on("error", () => undefined);
    try {
      const open = await server.waitFor("connectionOpen");
      const connection = packConnectionHandle(open.index, open.generation);
      const socket = new VentiwsSocket(null);
      attachNativeSocket(socket, server.handle, connection);

      const errors: CodedError[] = [];
      socket.on("error", (error: Error) => {
        errors.push(error as CodedError);
      });
      socket.close(1000, "bye");
      socket.close(1000, "bye");

      // One report for the one unsupported condition, and no close frame was written.
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe("ERR_POLICY_VIOLATION");
      expect(errors[0]?.message).toMatch(/app-initiated close is not implemented/);
      expect(socket.readyState).toBe(OPEN);
      expect(closeFrameWritten(socket)).toBe(false);

      // Still usable: a send stages, and the engine still hands the peer's bytes up.
      await new Promise<void>((resolve, reject) => {
        socket.send("still open", (failure?: Error) => {
          if (failure) reject(failure);
          else resolve();
        });
      });
      expect(socket.bufferedAmount).toBe("still open".length);
      client.send("from the peer");
      await server.waitFor("connectionMessage");
      expect(takeSocketMessage(server.handle, connection)?.bytes.toString("utf8")).toBe(
        "from the peer",
      );
    } finally {
      client.terminate();
      await server.dispose();
    }
  },
);
