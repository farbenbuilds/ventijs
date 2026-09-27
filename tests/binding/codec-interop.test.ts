import { expect, test } from "vitest";
import { WebSocketServer as WsServer } from "ws";
import {
  CODEC_KINDS,
  codecFeedResume,
  codecOutbound,
  codecOutboundMasked,
  destroyCodec,
  encodeCodecFrame,
  feedCodec,
} from "../../src/binding/codec";
import { drain } from "./codec-frames";
import { clientCodec, serverCodec } from "./codec-support";
import { openRawClient, TEST_TIMEOUT_MS } from "./codec-net";
import { openClient, startRawPeer, waitFor } from "./codec-peer";

/// `encode` takes an ordinal, and a decoded event reports a name, so both are named
/// here rather than being written as a bare `indexOf` result at each use. Comparing
/// an event's name against an ordinal is a type error in the types and a silent
/// never-true comparison at runtime, which is the worse of the two.
const TEXT_ORDINAL = CODEC_KINDS.indexOf("text");
const TEXT = "text";
const BINARY = "binary";
const PING = "ping";
const CLOSE = "close";

test(
  "a real ws client's masked frames decode through the codec",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await startRawPeer();
    const client = await openClient(`ws://127.0.0.1:${peer.port}`);
    const handle = serverCodec();
    try {
      client.send("hello");
      client.send(Buffer.from([0, 1, 2, 255]));
      client.ping();
      client.close(1000, "bye");
      // One read may hold several frames, one frame may span several reads, and one
      // batch may outrun the queue, so the loop tracks the unconsumed remainder and
      // feeds it again after draining, exactly as a connection's read handler has to.
      const events = [] as ReturnType<typeof drain>;
      let pending: Buffer = Buffer.alloc(0);
      while (events.filter((event) => event.kind === CLOSE).length < 1) {
        if (pending.length === 0) pending = await peer.read();
        const outcome = feedCodec(handle, pending);
        events.push(...drain(handle));
        if (outcome.kind === "failed") break;
        // A refusal carries no count, so the offset comes from the codec itself. A
        // full queue is not a failure: the rest of the input is still good.
        const consumed = outcome.kind === "consumed" ? outcome.bytes : codecFeedResume(handle);
        expect(consumed).toBeGreaterThan(0);
        pending = pending.subarray(consumed);
      }
      // A `ws` client masks, which is the discipline a server codec enforces, and it
      // interleaves a control frame among its data messages.
      const kinds = events.map((event) => event.kind);
      expect(kinds).toContain(PING);
      expect(kinds).toContain(CLOSE);
      // A text frame and a binary frame are two different events, not one event
      // inspected twice: the opcode is what tells a caller which buffer it holds.
      const texts = events.filter((event) => event.kind === TEXT);
      expect(texts.map((event) => event.payload.toString())).toContain("hello");
      const binaries = events.filter((event) => event.kind === BINARY);
      expect(binaries.map((event) => [...event.payload])).toEqual([[0, 1, 2, 255]]);
      const close = events.find((event) => event.kind === CLOSE);
      expect(close?.code).toBe(1000);
      expect(close?.payload.toString()).toBe("bye");
    } finally {
      destroyCodec(handle);
      client.close();
      await peer.close();
    }
  },
);

test(
  "a codec frames a message a real ws client accepts",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await startRawPeer();
    const client = await openClient(`ws://127.0.0.1:${peer.port}`);
    const handle = serverCodec();
    try {
      const message = new Promise<string>((resolve, reject) => {
        client.on("message", (data) => resolve(data.toString()));
        client.on("error", reject);
      });
      const length = frame(handle, "from the codec");
      // A server must not mask, and `ws` refuses a masked frame from a server.
      expect(codecOutboundMasked(handle)).toBe(false);
      await peer.send(codecOutbound(handle).subarray(0, length));
      await expect(message).resolves.toBe("from the codec");
    } finally {
      destroyCodec(handle);
      client.close();
      await peer.close();
    }
  },
);

test(
  "a client codec masks a message a real ws server accepts",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const received: string[] = [];
    const server = new WsServer({ port: 0 });
    await new Promise<void>((resolve) => {
      server.once("listening", () => resolve());
    });
    server.on("connection", (socket) => {
      // A `ws` server hands a text frame over as a Buffer under the default
      // `binaryType`, so the comparison is on its bytes rather than on its type.
      socket.on("message", (data) => received.push(data.toString()));
    });
    // A `ws` client would re-frame anything handed to `send`, so the handshake is
    // done here and the codec's own bytes go on the wire: `ws` reads, it does not
    // write, which is the only arrangement in which it can judge the frame.
    const socket = await openRawClient(boundPort(server));
    const handle = clientCodec();
    try {
      const length = frame(handle, "masked by the codec");
      // A client must mask, and `ws` closes a connection that sends an unmasked one.
      expect(codecOutboundMasked(handle)).toBe(true);
      socket.write(codecOutbound(handle).subarray(0, length));
      await expect(waitFor(() => received.length > 0)).resolves.toBeUndefined();
      expect(received).toEqual(["masked by the codec"]);
    } finally {
      destroyCodec(handle);
      socket.destroy();
      server.close();
    }
  },
);

/// The port a `ws` server bound, which its type widens to an address or a pipe.
function boundPort(server: WsServer): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/// One complete, uncompressed text frame from a codec, and its length.
///
/// The `false` is `compress`, and it is written out here rather than left to a reader:
/// these cases are about masking and framing, so a reader should be able to see that
/// nothing about this frame depends on RFC 7692.
function frame(handle: bigint, text: string): number {
  return encodeCodecFrame(handle, TEXT_ORDINAL, true, Buffer.from(text), false);
}
