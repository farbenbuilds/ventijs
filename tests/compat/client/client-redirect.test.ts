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
      // The request and the response, which is what `ws` hands over and what a caller
      // needs in order to decide: the path tells it where it went and the status tells it
      // what it was refused with. The previous payload was a URL and a number, so
      // reading the 404's own headers was impossible.
      const seen: Array<[string, number, string | undefined]> = [];
      socket.on("unexpected-response", (request, response) =>
        seen.push([
          request.path,
          response.statusCode ?? 0,
          String(response.headers["x-peek"] ?? ""),
        ]),
      );
      // A listener takes the refusal over, so there is no error to await: the caller is
      // the one deciding now.
      expect((await refused(socket)).statusCode).toBe(404);
      expect(seen).toEqual([["/", 404, "refused-by-peer"]]);
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
      // The offer is only real if the response is a live `IncomingMessage`, so its body
      // is read here; `permessage-deflate.test.ts` and
      // `client-handshake-events.test.ts` read its headers and its path.
      const challenge = new Promise<string>((resolve) => {
        socket.on("unexpected-response", (_request, response) => {
          response.setEncoding("utf8");
          const chunks: string[] = [];
          response.on("data", (chunk: string) => chunks.push(chunk));
          response.on("end", () => resolve(chunks.join("")));
        });
      });
      expect((await refused(socket)).statusCode).toBe(401);
      expect(await challenge).toBe("token required\n");
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
