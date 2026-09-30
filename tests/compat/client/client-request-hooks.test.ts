// `finishRequest` and `generateMask`: the two `ws` options that were typed and inert.
//
// Both are declared by `@types/ws`, so a TypeScript caller reaches them without a cast
// and reasonably believes they work. `finishRequest` is the last chance to touch the
// opening request, which is the only point at which a signature or a `Cookie` can still
// be set; `generateMask` is the only way to control the key a client masks with.

import type { Socket } from "node:net";
import { expect, test } from "vitest";
import { WebSocket, type ClientOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer } from "./client-support";
import { rawAcceptServer, type RawPeer } from "./raw-peer";

/// The masking key of the first frame a client sends, read off the wire.
///
/// The proof has to be the bytes: a callback that ran is not a callback whose output the
/// encoder used, and only a peer reading the frame can tell those apart.
async function firstMaskKey(peer: RawPeer, options: ClientOptions): Promise<string> {
  const client = new WebSocket(peer.url, options);
  try {
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });
    client.send("hi", () => undefined);
    const socket = await peer.accepted;
    const frame = await readFrame(socket);
    // Two header bytes then the four-byte key, for a frame short enough not to carry an
    // extended length. The mask bit has to be set, or there is no key to read.
    expect((frame[1] as number) & 0x80).toBe(0x80);
    return frame.subarray(2, 6).toString("hex");
  } finally {
    client.terminate();
  }
}

/// One whole frame, taken from whatever the peer has buffered.
///
/// A client frame is always masked, so the header is the two base bytes, an optional
/// extended length, and the four-byte key. The whole frame has to be in before the key
/// can be read, which is why this waits rather than slicing on the first two bytes.
function readFrame(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("no frame within the timeout")), 5000);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const frame = frameLength(buffered);
      if (frame === null) return;
      clearTimeout(timer);
      socket.off("data", onData);
      resolve(buffered.subarray(0, frame));
    };
    socket.on("data", onData);
  });
}

/// The whole frame length a header declares, or null while it is still incomplete.
function frameLength(head: Buffer): number | null {
  if (head.length < 2) return null;
  const short = (head[1] as number) & 0x7f;
  const extended = short === 126 ? 2 : short === 127 ? 8 : 0;
  if (head.length < 2 + extended) return null;
  const payload =
    extended === 2
      ? head.readUInt16BE(2)
      : extended === 8
        ? Number(head.readBigUInt64BE(2))
        : short;
  const total = 2 + extended + 4 + payload;
  return head.length >= total ? total : null;
}

test("finishRequest runs before the request goes out", { timeout: TEST_TIMEOUT_MS }, async () => {
  const states: number[] = [];
  const { socket, harness } = await openWithPeer(() => undefined, undefined, undefined, {
    finishRequest: (req, websocket) => {
      states.push(websocket.readyState);
      req.end();
    },
  } as ClientOptions);
  try {
    // `ws` hands the callback the socket while it is still `CONNECTING`, because the
    // request has not gone out and so neither has the connection.
    expect(states).toEqual([WebSocket.CONNECTING]);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  } finally {
    socket.terminate();
    await harness.close();
  }
});

test("a header set by finishRequest is not too late", { timeout: TEST_TIMEOUT_MS }, async () => {
  const peer = await rawAcceptServer();
  const client = new WebSocket(peer.url, {
    finishRequest: (req) => {
      // `setHeader` after `end()` is `ERR_HTTP_HEADERS_SENT`, so reaching the handshake
      // at all is the assertion: a request already sent could not have done this.
      req.setHeader("X-Finish", "yes");
      req.end();
    },
  } as ClientOptions);
  try {
    await new Promise<void>((resolve, reject) => {
      client.on("open", resolve);
      client.on("error", reject);
    });
    expect(client.readyState).toBe(WebSocket.OPEN);
  } finally {
    client.terminate();
    await peer.close();
  }
});

test(
  "generateMask supplies the key the frame is masked with",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await rawAcceptServer();
    try {
      const key = await firstMaskKey(peer, {
        generateMask: (mask) => mask.fill(0xa5),
      } as ClientOptions);
      expect(key).toBe("a5a5a5a5");
    } finally {
      await peer.close();
    }
  },
);

test("a client without generateMask still masks", { timeout: TEST_TIMEOUT_MS }, async () => {
  const peer = await rawAcceptServer();
  try {
    const key = await firstMaskKey(peer, {});
    // A key the engine drew, so eight hex digits and not the fixed bytes above.
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(key).not.toBe("a5a5a5a5");
  } finally {
    await peer.close();
  }
});
