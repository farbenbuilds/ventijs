//! What a `ws` server does with what the client sends, and what the client reads back.
//!
//! The peer is `ws`'s, so each case asks whether `ws` accepts this client's frames and
//! whether this client reads `ws`'s. The frame shapes are the subject of
//! `client-frames.test.ts`, and how a connection opens and ends is the subject of
//! `client-lifecycle.test.ts`.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { open, openWithPeer, waitFor } from "./client-support";

test(
  "a client reaches open and the server sees a connection",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { socket, peer, harness } = await openWithPeer(() => undefined);
    try {
      expect(peer).toBeDefined();
      expect(socket.readyState).toBe(WebSocket.OPEN);
      // `ws` reports the parsed URL rather than the string it was given, so the scheme
      // is the `ws:` one even when the caller passed `http:`, and a bare authority
      // gains the `/` a URL always has.
      expect(socket.url).toBe(`${harness.url}/`);
      socket.close();
    } finally {
      await harness.close();
    }
  },
);

test("a message from a ws server reaches the client", { timeout: TEST_TIMEOUT_MS }, async () => {
  const messages: string[] = [];
  const { socket, harness } = await openWithPeer(
    (peer) => {
      peer.send("from the server");
    },
    (client) => {
      client.on("message", (data) => messages.push(data.toString()));
    },
  );
  try {
    // The peer sends on connection, so the frame arrives before this client's `open`
    // resolves and waits in the codec until the queue drains.
    await waitFor(() => messages.length === 1);
    expect(messages[0]).toBe("from the server");
    socket.close();
  } finally {
    await harness.close();
  }
});

test("a message from the client reaches a ws server", { timeout: TEST_TIMEOUT_MS }, async () => {
  const received: string[] = [];
  const { socket, harness } = await openWithPeer((peer) => {
    peer.on("message", (data) => received.push(data.toString()));
  });
  try {
    socket.send("from the client");
    await waitFor(() => received.length === 1);
    expect(received[0]).toBe("from the client");
    socket.close();
  } finally {
    await harness.close();
  }
});

test("a ping from the client is answered and reported", { timeout: TEST_TIMEOUT_MS }, async () => {
  const peerPings: string[] = [];
  const clientPongs: string[] = [];
  const { socket, harness } = await openWithPeer(
    (peer) => {
      peer.on("ping", (data) => peerPings.push(data.toString()));
    },
    (client) => {
      client.on("pong", (data) => clientPongs.push(data.toString()));
    },
  );
  try {
    // The peer reports the ping and this client reports the pong, and neither side
    // reports its own automatic reply: `ws` answers a ping without emitting `pong` for
    // it, so a client that emitted one would be a client that differs.
    //
    // The pong also has to be *read* as a pong. It arrives unmasked, which is what a
    // server is required to send, and a client codec built as a server would refuse it
    // with a 1002 for a frame the peer was entitled to send.
    socket.ping("beat");
    await waitFor(() => peerPings.length === 1 && clientPongs.length === 1);
    expect(peerPings[0]).toBe("beat");
    expect(clientPongs[0]).toBe("beat");
    socket.close();
  } finally {
    await harness.close();
  }
});

test(
  "a negotiated subprotocol is reported on the client",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { socket, harness } = await openWithPeer(() => undefined, undefined, ["chat"]);
    try {
      expect(socket.protocol).toBe("chat");
      socket.close();
    } finally {
      await harness.close();
    }
  },
);

test("a server that picks no subprotocol is refused", { timeout: TEST_TIMEOUT_MS }, async () => {
  // Asking for a subprotocol and getting none is a protocol error rather than a
  // default: a caller that depends on the language its peer speaks has no other way
  // to notice it was given something else. The peer answers the handshake properly and
  // simply omits the header, which is what makes this a check and not a refusal to
  // connect.
  const { rawAcceptServer } = await import("./raw-peer");
  const peer = await rawAcceptServer();
  try {
    await expect(open(peer.url, undefined, ["chat"])).rejects.toThrow(/no subprotocol/);
  } finally {
    await peer.close();
  }
});
