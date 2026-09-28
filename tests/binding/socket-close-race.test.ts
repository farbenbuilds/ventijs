//! What the engine route does with a peer that sends a message and a close in one read.
//!
//! Both frames are parsed in one pass on the engine thread and both are staged before
//! Node runs, so by the time the application takes the message the connection has already
//! been closed and its slab slot released. The take used to resolve a connection handle
//! first, so it returned null and the message the engine had already parsed was dropped
//! and counted as lost. This is Autobahn case 7.1.1, and it is data loss rather than a
//! conformance detail: the peer sent a message and the application never saw it.

import { connect } from "node:net";
import { expect, test } from "vitest";
import { clientFrames } from "./codec-frames";
import { request, UPGRADE_HEADERS } from "../compat/server/upgrade-support";
import { startEcho } from "./echo-support";

const TEST_TIMEOUT_MS = 20_000;

/// A text frame and a close frame in a single write, which is what puts both on the
/// wire in one read and makes the engine parse them in one `on_data` pass.
const MESSAGE_THEN_CLOSE: Buffer = Buffer.concat([
  clientFrames([{ opcode: 0x1, payload: Buffer.from("in the same read") }]),
  clientFrames([{ opcode: 0x8, payload: Buffer.from([0x03, 0xe8]) }]),
]);

test(
  "a message staged in the same read as a peer close still reaches the application",
  async () => {
    const echo = await startEcho();
    const socket = connect(echo.port, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.on("error", () => undefined);
      socket.write(request("/", UPGRADE_HEADERS));
      // One write, so the engine's read carries both frames.
      socket.write(MESSAGE_THEN_CLOSE);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(echo.received.map((reply) => reply.bytes.toString("utf8"))).toEqual([
        "in the same read",
      ]);
    } finally {
      socket.destroy();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "a later connection is unaffected by the closed one",
  async () => {
    const echo = await startEcho();
    const first = connect(echo.port, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        first.once("connect", resolve);
        first.once("error", reject);
      });
      first.on("error", () => undefined);
      first.write(request("/", UPGRADE_HEADERS));
      first.write(MESSAGE_THEN_CLOSE);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const second = connect(echo.port, "127.0.0.1");
      try {
        await new Promise<void>((resolve, reject) => {
          second.once("connect", resolve);
          second.once("error", reject);
        });
        second.on("error", () => undefined);
        second.write(request("/", UPGRADE_HEADERS));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(echo.connection).toBeTypeOf("function");
      } finally {
        second.destroy();
      }
    } finally {
      first.destroy();
      await echo.dispose();
    }
  },
  TEST_TIMEOUT_MS,
);
