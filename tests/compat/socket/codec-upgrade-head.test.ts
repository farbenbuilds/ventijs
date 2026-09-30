// A client may coalesce its first frame with the upgrade request, and Node hands those
// bytes back as the upgrade event's `head`; dropping them silently loses the frame.

import { connect } from "node:net";
import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { upgradeHarness, waitFor } from "./codec-upgrade-support";
import { maskedFrame } from "./raw-peer";
import { request, UPGRADE_HEADERS } from "../server/upgrade-support";

test(
  "a frame coalesced with the upgrade request is delivered",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Asynchronous events, so the connection handler has a tick to attach the message
    // listener after the pending bytes are fed during the handshake.
    const server = new WebSocketServer({ noServer: true, allowSynchronousEvents: false });
    const harness = await upgradeHarness(server);
    const messages: string[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (data) => messages.push(data.toString()));
    });
    const socket = connect(harness.port, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      socket.write(
        Buffer.concat([
          Buffer.from(request("/", UPGRADE_HEADERS)),
          maskedFrame(0x1, Buffer.from("early")),
        ]),
      );
      await waitFor(() => messages.length === 1);
      expect(messages[0]).toBe("early");
    } finally {
      socket.destroy();
      await harness.close();
    }
  },
);
