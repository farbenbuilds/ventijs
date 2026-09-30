// Whether RSV1 goes out, read off the wire.
//
// Split out of `permessage-deflate.test.ts` because that module's claim is
// interoperability -- a `ws` peer reads what this build writes -- and a `ws` peer
// decompresses transparently, so it cannot show *whether* a payload was compressed. These
// cases are the only ones that can, and they are the ones that would still pass against
// an implementation that never set RSV1 at all.

import { expect, test } from "vitest";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { nextSocket, upgradeHarness } from "./codec-upgrade-support";
import {
  COMPRESSIBLE,
  COMPRESSIBLE_LENGTH,
  deflateServer,
  NEGOTIATED,
  SMALL,
  WS_OFFER,
} from "./deflate-support";
import { compressedTextFrame, offerExtension, readFrame } from "./raw-peer";

test(
  "a message above the threshold is compressed and a small one is not",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // Read off the wire, because a `ws` peer decompresses transparently and a round trip
    // through one cannot show which of the two happened.
    const harness = await upgradeHarness(deflateServer());
    const accepted = nextSocket(harness.server);
    const handshake = await offerExtension(harness.port, WS_OFFER);
    try {
      expect(handshake.status).toBe(101);
      expect(handshake.headers["sec-websocket-extensions"]).toBe(NEGOTIATED);
      const socket = await accepted;
      socket.send(COMPRESSIBLE);
      const large = await readFrame(handshake.socket);
      expect(large.rsv1).toBe(true);
      expect(large.inflated.toString()).toBe(COMPRESSIBLE);
      // Short of the threshold, deflate more often than not makes the message longer, so
      // the threshold exists to skip it and `ws` skips it.
      // Short of the threshold, deflate more often than not makes the message longer, so
      // the threshold exists to skip it and `ws` skips it.
      socket.send(SMALL);
      const small = await readFrame(handshake.socket);
      expect(small.rsv1).toBe(false);
      expect(small.payload.toString()).toBe(SMALL);
    } finally {
      handshake.socket.destroy();
      await harness.close();
    }
  },
);

test(
  "a raised threshold leaves a message that used to compress alone",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The option is read: with the threshold above the payload, the same message goes out
    // uncompressed. Without this the threshold would be a constant and every assertion
    // about the default would pass for the wrong reason.
    const harness = await upgradeHarness(
      new WebSocketServer({
        noServer: true,
        perMessageDeflate: { threshold: COMPRESSIBLE_LENGTH * 2 },
      }),
    );
    const accepted = nextSocket(harness.server);
    const handshake = await offerExtension(harness.port, "permessage-deflate");
    try {
      expect(handshake.status).toBe(101);
      const socket = await accepted;
      socket.send(COMPRESSIBLE);
      const frame = await readFrame(handshake.socket);
      expect(frame.rsv1).toBe(false);
      expect(frame.payload.length).toBe(COMPRESSIBLE_LENGTH);
    } finally {
      handshake.socket.destroy();
      await harness.close();
    }
  },
);

test("a server with the extension off never sets RSV1", { timeout: TEST_TIMEOUT_MS }, async () => {
  const harness = await upgradeHarness(
    new WebSocketServer({ noServer: true, perMessageDeflate: false }),
  );
  const accepted = nextSocket(harness.server);
  // Offered anyway, which is what a peer ignoring the server's configuration does.
  const handshake = await offerExtension(harness.port, WS_OFFER);
  try {
    expect(handshake.status).toBe(101);
    expect(handshake.headers["sec-websocket-extensions"]).toBeUndefined();
    const socket = await accepted;
    expect(socket.extensions).toBe("");
    socket.send(COMPRESSIBLE);
    const frame = await readFrame(handshake.socket);
    expect(frame.rsv1).toBe(false);
  } finally {
    handshake.socket.destroy();
    await harness.close();
  }
});

test(
  "a compressed frame on a connection that negotiated nothing is closed with 1002",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // RFC 6455 section 5.2: RSV1 is only meaningful when an extension negotiated it, so a
    // peer that sets it anyway commits a protocol error and 1002 is its code.
    const harness = await upgradeHarness(
      new WebSocketServer({ noServer: true, perMessageDeflate: false }),
    );
    const accepted = nextSocket(harness.server);
    const handshake = await offerExtension(harness.port, "permessage-deflate");
    try {
      expect(handshake.status).toBe(101);
      const socket = await accepted;
      // A refused frame is a protocol error, so `ws` emits `error` and then `close`.
      // Both are asserted rather than just one: an error with no close leaves the
      // socket open, and a close with no error hides why the connection ended.
      const events: string[] = [];
      const closed = new Promise<number>((resolve) => socket.on("close", resolve));
      socket.on("error", () => events.push("error"));
      handshake.socket.write(compressedTextFrame("hi"));
      const close = await readFrame(handshake.socket);
      expect(close.opcode).toBe(0x8);
      expect(close.payload.readUInt16BE(0)).toBe(1002);
      expect(await closed).toBe(1002);
      expect(events).toEqual(["error"]);
    } finally {
      handshake.socket.destroy();
      await harness.close();
    }
  },
);
