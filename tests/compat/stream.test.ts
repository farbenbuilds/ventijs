//! `createWebSocketStream` on ventijs's own server: the two `ws` behaviours a caller can
//! only see on a live connection, pinned to the values `ws` produces.

import { expect, test } from "vitest";
import { createWebSocketStream } from "../../src/compat/stream";
import { openRawClient } from "../binding/codec-net";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { nextSocket, openClient, upgradeHarness, waitFor } from "./socket/codec-upgrade-support";
import { maskedFrame } from "./socket/raw-peer";
import { attached, terminateClient } from "./socket/socket-support";

test(
  "createWebSocketStream writes through the socket transport",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { server, client, socket } = await attached();
    try {
      const stream = createWebSocketStream(socket);
      await new Promise<void>((resolve, reject) => {
        stream.write("streamed", (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      expect(socket.bufferedAmount).toBe(8);
      stream.destroy();
    } finally {
      terminateClient(client);
      await server.dispose();
    }
  },
);

/// `readableObjectMode` is the whole of `ws`'s conversion rule (stream.js:63-64), so these
/// are its cases: the string is decoded text, an empty payload is an empty string rather
/// than a zero-length Buffer, and a binary message is never converted.
const TEXTS: ReadonlyArray<readonly [string, string]> = [
  ["an empty payload", ""],
  ["a multi-byte payload", "héllo ✓"],
];

test.each(TEXTS)(
  "a text message in object mode arrives as %s",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, text) => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const stream = createWebSocketStream(socket, { readableObjectMode: true });
      const chunks: unknown[] = [];
      stream.on("data", (chunk: unknown) => {
        chunks.push(chunk);
      });
      client.send(text);
      client.send(Buffer.from("bin"));
      await waitFor(() => chunks.length === 2);
      expect(chunks).toEqual([text, Buffer.from("bin")]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

/// `ws` settles `_final` from the raw socket's `finish`, which `Sender.close` triggers by
/// ending that socket with the close frame, so `end`'s callback lands on the frame leaving
/// rather than on the peer answering it. Asserted as an order because that is the contract:
/// a teardown that waits for the handshake passes a test that only checks the close code.
test(
  "end settles before the peer has answered the close frame",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const stream = createWebSocketStream(socket);
      stream.resume();
      const order: string[] = [];
      socket.on("close", () => order.push("socket:close"));
      await new Promise<void>((resolve) => {
        stream.end(() => {
          order.push("end:callback");
          resolve();
        });
      });
      expect(order).toEqual(["end:callback"]);
      await waitFor(() => order.length > 1);
      expect(order).toEqual(["end:callback", "socket:close"]);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

/// The socket raised the error, so the stream must report it rather than swallow it, and
/// `terminate()` must not be what ended the socket or the peer would have seen a reset.
/// Opcode 3 is reserved (RFC 6455 section 5.2), so the codec refuses the frame.
test(
  "a refused frame reaches the stream as an error, then a close",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const raw = await openRawClient(harness.port);
    try {
      const socket = await accepted;
      const stream = createWebSocketStream(socket);
      const seen: string[] = [];
      stream.on("error", () => seen.push("error"));
      stream.on("close", () => seen.push("stream:close"));
      raw.write(maskedFrame(0x3, Buffer.alloc(0)));
      await waitFor(() => seen.includes("stream:close"));
      expect(seen).toEqual(["error", "stream:close"]);
    } finally {
      raw.destroy();
      await harness.close();
    }
  },
);
