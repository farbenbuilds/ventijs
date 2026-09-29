//! RFC 7692 on the wire. The `ws` peers prove interoperability -- a message this build
//! compresses is a message `ws` reads, and the other way round -- while the raw peer proves the
//! *decisions* (which header went out, whether RSV1 is set), because `ws` decompresses
//! transparently and would hide both.

import { expect, test } from "vitest";
import { WebSocketServer as WsServer } from "ws";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { COMPRESSIBLE, deflateServer, NEGOTIATED } from "./deflate-support";
import { nextSocket, openClient, upgradeHarness } from "./codec-upgrade-support";

/// A message this build delivers whole.
function messageFrom(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => socket.once("message", (data) => resolve(data.toString())));
}

test(
  "a ws client's compressed message reaches a ventijs socket",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // A browser or a `ws` client compressing, this build inflating, the application seeing the original text.
    const harness = await upgradeHarness(deflateServer());
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      expect(socket.extensions).toBe(NEGOTIATED);
      const message = messageFrom(socket);
      client.send(COMPRESSIBLE);
      expect(await message).toBe(COMPRESSIBLE);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a ventijs socket's compressed message reaches a ws client",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const harness = await upgradeHarness(deflateServer());
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url);
    try {
      const socket = await accepted;
      const message = new Promise<string>((resolve) =>
        client.once("message", (data) => resolve(data.toString())),
      );
      socket.send(COMPRESSIBLE);
      expect(await message).toBe(COMPRESSIBLE);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test(
  "a ventijs client negotiates against a ws server and compresses",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The client route writes the offer and reads the answer, and a `ws` server's answer is a
    // parameter set this codec did not choose. `perMessageDeflate: true` is not a `ws` *server* default, so the case would pass uncompressed.
    const server = new WsServer({ port: 0, perMessageDeflate: true });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const received = new Promise<string>((resolve) => {
        server.once("connection", (peer) => {
          peer.once("message", (data) => resolve(data.toString()));
        });
      });
      const client = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        client.once("open", resolve);
        client.once("error", reject);
      });
      expect(client.extensions).toContain("permessage-deflate");
      expect(client.extensions).toContain("no_context_takeover");
      client.send(COMPRESSIBLE);
      expect(await received).toBe(COMPRESSIBLE);
      client.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "a ws client that does not offer the extension still connects uncompressed",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // An extension nobody offered is not an error; refusing it would make every compression-disabled client a 400.
    const harness = await upgradeHarness();
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url, { perMessageDeflate: false });
    try {
      const socket = await accepted;
      expect(socket.extensions).toBe("");
      const message = messageFrom(socket);
      client.send(COMPRESSIBLE);
      expect(await message).toBe(COMPRESSIBLE);
    } finally {
      client.close();
      await harness.close();
    }
  },
);

test.each([
  ["serverMaxWindowBits: 15", { serverMaxWindowBits: 15 }],
  ["clientMaxWindowBits: 12", { clientMaxWindowBits: 12 }],
])(
  "a ws client asking for %s connects and its messages arrive",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, perMessageDeflate) => {
    // Both of these are valid `@types/ws` options, and both used to be answered with a
    // bare 400: the refusal was unconditional on any `server_max_window_bits`, and any
    // `client_max_window_bits` below 15 was read as a limit on this server rather than as
    // the window the client said it would use. 15 is the maximum legal value and the one
    // this build emits, so refusing it refused a connection `ws` accepts.
    const harness = await upgradeHarness(deflateServer());
    const accepted = nextSocket(harness.server);
    const client = await openClient(harness.url, { perMessageDeflate });
    try {
      const socket = await accepted;
      const message = messageFrom(socket);
      client.send(COMPRESSIBLE);
      expect(await message).toBe(COMPRESSIBLE);
    } finally {
      client.close();
      await harness.close();
    }
  },
);
