//! RFC 7692 on the wire, against real `ws` peers and against raw bytes.
//!
//! The split is deliberate. The `ws` peers prove interoperability, which is the claim
//! that matters: a message this build compresses is a message `ws` reads, and the other
//! way round. The raw peer proves the *decisions* -- which header went out, whether RSV1
//! is set, which close code a peer earns -- because `ws` decompresses transparently and
//! would hide both.
//!
//! Every payload that is expected to compress is above the 1024-byte threshold by
//! construction, since the threshold is what decides the case, and a payload that did
//! not compress would make a byte count ambiguous and pass RSV1 assertions for the wrong
//! reason.

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
    // The direction a drop-in has to get right: a browser or a `ws` client compressing,
    // this build inflating, and the application seeing the original text.
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
    // Not the same code as the two above: the client route writes the offer and reads the
    // answer, and a `ws` server's answer is a parameter set this codec did not choose.
    // `perMessageDeflate: true` is not the default on a `ws` *server*
    // (`websocket-server.js:76`), so without it the offer is declined and the whole case
    // would pass on an uncompressed connection.
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
    // The negative case, and the one a "negotiated or bust" implementation gets wrong: an
    // extension nobody offered is not an error, and refusing it would make every
    // compression-disabled client a 400.
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
