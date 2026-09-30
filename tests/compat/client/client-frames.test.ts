// What the client's frames look like on the wire, judged by a `ws` server.
//
// Its own file because the question is about the bytes rather than the events: a
// server that refuses an unmasked frame, a binary payload that keeps its bytes, and a
// message that survives the round trip at the size where framing stops being trivial.

import { expect, test } from "vitest";
import { engineLimits } from "../../../src/binding/server";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer, waitFor } from "./client-support";

test("a binary message keeps its bytes", { timeout: TEST_TIMEOUT_MS }, async () => {
  const received: string[] = [];
  const { socket, harness } = await openWithPeer((peer) => {
    peer.on("message", (data, isBinary) => {
      if (isBinary) received.push(data.toString("latin1"));
    });
  });
  try {
    // Latin-1 rather than UTF-8, because a UTF-8 decode of 0xff invents a
    // replacement character and the assertion would pass for the wrong reason.
    socket.send(Buffer.from([0, 1, 2, 255]));
    await waitFor(() => received.length === 1);
    expect(received[0]).toBe("\u0000\u0001\u0002\u00ff");
    socket.close();
  } finally {
    await harness.close();
  }
});

test("a client masks the frames it sends", { timeout: TEST_TIMEOUT_MS }, async () => {
  // A server must refuse an unmasked frame from a client, so `ws` accepting the
  // message at all is the proof that the codec was built in the client role rather
  // than assumed from the server's shape.
  const received: string[] = [];
  const { socket, harness } = await openWithPeer((peer) => {
    peer.on("message", (data) => received.push(data.toString()));
  });
  try {
    socket.send("masked");
    await waitFor(() => received.length === 1);
    expect(received[0]).toBe("masked");
    socket.close();
  } finally {
    await harness.close();
  }
});

test("a message at the capacity limit reaches the peer", { timeout: TEST_TIMEOUT_MS }, async () => {
  const received: string[] = [];
  const { socket, harness } = await openWithPeer((peer) => {
    peer.on("message", (data) => received.push(data.toString()));
  });
  try {
    // The compiled capacity, exactly: a message at the limit has to survive, and one
    // byte over it has to be refused. That pair is what `autobahn` measures, so a
    // limit that cannot be reached is a limit that was never tested.
    const atLimit = "y".repeat(engineLimits().messageBytes);
    socket.send(atLimit);
    await waitFor(() => received.length === 1);
    expect(received[0]?.length).toBe(atLimit.length);
    socket.close();
  } finally {
    await harness.close();
  }
});
