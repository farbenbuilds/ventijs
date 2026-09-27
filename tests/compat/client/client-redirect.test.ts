//! A redirect chain, and the rules about what may be carried through one.
//!
//! A redirect is something that happens *before* a peer is a WebSocket server, which
//! makes it the one handshake path a real deployment hits routinely — a load balancer
//! or a CDN that moves a socket URL — and the one whose failure mode is a connection
//! that silently never opens.

import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { handshakePeer, redirectingPeer, scriptedPeer } from "./redirect-peer";
import { undeclared } from "./undeclared";

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function failed(socket: WebSocket): Promise<Error> {
  return new Promise((resolve) => {
    socket.on("error", resolve);
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
  "without followRedirects a redirect is reported and refused",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const elsewhere = await handshakePeer();
    const peer = await redirectingPeer(elsewhere.url);
    const socket = new WebSocket(peer.url);
    try {
      // The caller is told where it would have been sent, which is the point of the
      // event, and the connection fails rather than being made without asking.
      const seen: string[] = [];
      socket.on("redirect", (url) => seen.push(url));
      const error = await failed(socket);
      // The reported URL is the parsed one, so a bare authority gains the `/` a URL
      // always has, which is the string `url` would report for the same address.
      expect(seen[0]).toBe(`${elsewhere.url}/`);
      expect(error.message).toContain("302");
      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await peer.close();
      await elsewhere.close();
    }
  },
);

test(
  "an unexpected response is reported with its status",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await scriptedPeer({ first: 404, after: 101 });
    const socket = new WebSocket(peer.url);
    try {
      const seen: Array<[string, number]> = [];
      socket.on("unexpected-response", (url, status) => seen.push([url, status]));
      const error = await failed(socket);
      expect(seen).toEqual([[`${peer.url}/`, 404]]);
      expect(error.message).toContain("404");
    } finally {
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
