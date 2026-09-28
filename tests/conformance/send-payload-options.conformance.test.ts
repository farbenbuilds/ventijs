//! The three `send` options that were ignored: `compress`, `mask`, and a `Blob` payload.
//!
//! All three were wrong on the wire rather than absent. `compress: false` compressed anyway, so
//! a caller shipping already-compressed payloads paid a deflate on both ends for nothing. A
//! `Blob` threw, though `ws` accepts one and its own API reference lists it as a valid payload.
//! `mask: false` is the odd one: `ws` honours it, and the peer then refuses the frame, because
//! RFC 6455 section 5.1 requires a client to mask and a server to close on one that does not.

import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../src/index";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { nextSocket, upgradeHarness, waitFor } from "../compat/socket/codec-upgrade-support";
import { offerExtension, readFrame } from "../compat/socket/raw-peer";
import type { CodedError } from "../../src/types/errors";

/// A server that echoes, plus a client already connected to it. Shared by the cases that need
/// a message to come back rather than a frame to be read.
async function echoConnection(): Promise<{
  send: (data: unknown, options?: Record<string, unknown>) => void;
  echoed: Promise<string>;
  finish: () => Promise<void>;
}> {
  const server = new WebSocketServer({ port: 0, perMessageDeflate: true });
  server.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  const echoed = new Promise<string>((resolve) => {
    client.once("message", (data) => resolve(data.toString()));
  });
  await new Promise<void>((resolve) => client.once("open", () => resolve()));
  return {
    send: (data, options) => client.send(data as never, options as never),
    echoed,
    finish: () => {
      client.terminate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("a compressed payload comes back whole", { timeout: TEST_TIMEOUT_MS }, async () => {
  // Above the 1024-byte threshold, so this is compressed unless the option says otherwise.
  const { send, echoed, finish } = await echoConnection();
  try {
    const payload = "x".repeat(2048);
    send(payload);
    expect(await echoed).toBe(payload);
  } finally {
    await finish();
  }
});

test(
  "compress: false leaves RSV1 clear on a payload above the threshold",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Read off the wire rather than through a round trip, because a `ws` peer inflates
    // transparently: an echo comes back whole whether or not the frame was compressed, which
    // is exactly the bug. 2048 bytes is over the 1024-byte threshold, so only the option
    // stands between this and a compressed frame.
    const harness = await upgradeHarness(new WebSocketServer({ port: 0, perMessageDeflate: true }));
    const accepted = nextSocket(harness.server);
    const handshake = await offerExtension(harness.port, "permessage-deflate");
    try {
      expect(handshake.status).toBe(101);
      const socket = await accepted;
      socket.send("y".repeat(2048), { compress: false });
      const frame = await readFrame(handshake.socket);
      expect(frame.rsv1).toBe(false);
      expect(frame.inflated.toString()).toBe("y".repeat(2048));
    } finally {
      handshake.socket.destroy();
      await harness.close();
    }
  },
);

test("a Blob is sent as a binary message", { timeout: TEST_TIMEOUT_MS }, async () => {
  const { send, echoed, finish } = await echoConnection();
  try {
    send(new Blob(["blob-body"]) as unknown as string);
    expect(await echoed).toBe("blob-body");
  } finally {
    await finish();
  }
});

test("a send issued after a blob keeps its place", { timeout: TEST_TIMEOUT_MS }, async () => {
  // `ws` puts the blob read on its own sender queue, so the two arrive in the order they were
  // called. Reading the blob and letting the next send overtake it is the other order, and a
  // caller streaming a file as blobs depends on this one.
  const order: string[] = [];
  const server = new WebSocketServer({ port: 0 });
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      order.push(data.toString());
      socket.send(data);
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  try {
    await new Promise<void>((resolve) => client.once("open", () => resolve()));
    client.send(new Blob(["blob-first"]) as never);
    client.send("then-second");
    await waitFor(() => order.length === 2);
    expect(order).toEqual(["blob-first", "then-second"]);
  } finally {
    client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test(
  "mask: false is honoured, so the peer refuses the frame",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // RFC 6455 section 5.1: a client must mask. `ws` honours the option and its own server
    // answers `WS_ERR_EXPECTED_MASK` and closes, which is what a ventijs server does here too.
    // Before the fix the frame went out masked and neither side could tell the option had been
    // ignored, so a caller who set it had no way to find out.
    const server = new WebSocketServer({ port: 0 });
    const accepted = new Promise<WebSocket>((resolve) => server.once("connection", resolve));
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
    try {
      await new Promise<void>((resolve) => client.once("open", () => resolve()));
      const socket = await accepted;
      const failure = new Promise<CodedError>((resolve) => socket.once("error", resolve));
      client.send("abc", { mask: false });
      expect((await failure).code).toBe("WS_ERR_EXPECTED_MASK");
    } finally {
      client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
