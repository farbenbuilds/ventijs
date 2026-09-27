//! A redirect chain, and the rules about what may be carried through one.
//!
//! A redirect is something that happens *before* a peer is a WebSocket server, which
//! makes it the one handshake path a real deployment hits routinely — a load balancer
//! or a CDN that moves a socket URL — and the one whose failure mode is a connection
//! that silently never opens.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { closed, failed, refused } from "./client-support";
import { handshakePeer, redirectingPeer, scriptedPeer } from "./redirect-peer";
import { undeclared } from "./undeclared";

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

test(
  "followRedirects carries the connection to the new location",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const final = await handshakePeer();
    const first = await redirectingPeer(final.url);
    const socket = new WebSocket(first.url, undefined, undeclared({ followRedirects: true }));
    try {
      // The point of the option: the socket opens against the second server, and `url`
      // says where it actually ended up.
      await opened(socket);
      expect(socket.url.startsWith(final.url)).toBe(true);
      expect(socket.url).not.toBe(first.url);
    } finally {
      socket.terminate();
      await first.close();
      await final.close();
    }
  },
);

test(
  "without followRedirects a 3xx is refused and the close event fires",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const elsewhere = await handshakePeer();
    const peer = await redirectingPeer(elsewhere.url);
    const socket = new WebSocket(peer.url);
    try {
      // `ws` does not emit `redirect` for a hop it is not going to follow, so the 3xx
      // reaches the caller as an `error` and a `close`. Emitting `redirect` as well
      // promised a connection the client was not going to make.
      const seen: string[] = [];
      socket.on("redirect", (url) => seen.push(url));
      const error = await failed(socket);
      expect(seen).toEqual([]);
      expect(error.message).toContain("302");
      // The event, not the state: the state was 3 even when the event never fired.
      await closed(socket);
    } finally {
      await peer.close();
      await elsewhere.close();
    }
  },
);

test(
  "a refused response reports the status the peer sent",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await scriptedPeer({ first: 404, after: 101 });
    const socket = new WebSocket(peer.url);
    try {
      const seen: Array<[string, number]> = [];
      socket.on("unexpected-response", (url, status) => seen.push([url, status]));
      // A listener takes the refusal over, so there is no error to await: the caller is
      // the one deciding now.
      expect(await refused(socket)).toBe(404);
      expect(seen).toEqual([[`${peer.url}/`, 404]]);
    } finally {
      // A `terminate` on a socket that never opened reports the aborted handshake,
      // exactly as `ws` does, so the test has to be listening for it.
      socket.on("error", () => undefined);
      socket.terminate();
      await peer.close();
    }
  },
);

test(
  "an unexpected-response listener takes the refusal over",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await scriptedPeer({ first: 401, after: 101 });
    const socket = new WebSocket(peer.url);
    try {
      // The event exists so a caller can read the 401 before deciding. Aborting
      // unconditionally meant a listener could never act on what it was handed, which
      // made the event a notification of a teardown rather than an offer.
      expect(await refused(socket)).toBe(401);
      expect(socket.readyState).not.toBe(WebSocket.CLOSED);
    } finally {
      // A `terminate` on a socket that never opened reports the aborted handshake,
      // exactly as `ws` does, so the test has to be listening for it.
      socket.on("error", () => undefined);
      socket.terminate();
      await peer.close();
    }
  },
);

test(
  "a redirect that is not a URL is refused rather than dialled",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await redirectingPeer("ws://");
    const socket = new WebSocket(peer.url, undefined, undeclared({ followRedirects: true }));
    try {
      const error = await failed(socket);
      // A `Location` that does not parse is the redirect's problem rather than the
      // caller's, so it is reported through the socket instead of thrown at a listener.
      expect(error.message.length).toBeGreaterThan(0);
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await peer.close();
    }
  },
);
