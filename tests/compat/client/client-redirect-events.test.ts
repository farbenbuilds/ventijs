// The `redirect` and `unexpected-response` events, and the requests they carry.
//
// Their own module because both are about a caller taking responsibility for a decision:
// which hop to follow, and what to do about a response that is not a handshake. The
// `upgrade` event is the opposite -- it reports a success -- and `client-upgrade-event.ts`
// covers it.
//
// Every case reads something out of the payload that a reduced `(url, status)` pair could
// not have provided. A test that only checked the event fired would pass against the
// route these replace, which emitted both.

import type { ClientRequest } from "node:http";
import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { redirectingPeer } from "./redirect-peer";
import { CLOSE_DEADLINE_MS, settle } from "./handshake-support";
import { undeclared } from "./undeclared";

/// A header a caller sets on a hop, read back off the object it was handed. `setHeader`
/// before the request is sent is the documented way to change a hop, so the assertion is
/// that the object in the event is the one Node wrote: only that one can still be
/// changed.
const MARKER = "x-ventiws-hop";

/// A client that follows redirects and tears down promptly, which is what all four cases
/// need. Named so a case reads as its claim rather than as its configuration.
function following(url: string): WebSocket {
  return new WebSocket(
    url,
    undefined,
    undeclared({ followRedirects: true, closeTimeout: CLOSE_DEADLINE_MS }),
  );
}

/// The handshake is over when the socket opens, and no case may read the peer's record
/// before then: a record read mid-chain describes a hop that has not happened.
function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once("open", resolve));
}

test(
  "redirect reports the request for the hop that is about to go out",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The payload is the *next* hop's request, not the previous one's. A caller that wants
    // to drop a header on hop two has to be handed hop two's request, and the only way to
    // tell the two apart is by reading a header off it.
    const peer = await redirectingPeer("self/moved");
    const socket = following(peer.url);
    try {
      const hop = new Promise<[string, string | undefined]>((resolve) => {
        socket.once("redirect", (url, request: ClientRequest) => {
          resolve([url, String(request.getHeader(MARKER) ?? "")]);
        });
      });
      await opened(socket);
      const [url, marker] = await hop;
      expect(url).toContain("/moved");
      expect(marker).toBe("");
      // The peer saw the redirect's path, which is the claim the payload exists for: a
      // hop that reused the first request's path would come back here and loop.

      expect(peer.paths).toEqual(["/", "/moved"]);
    } finally {
      await settle(socket);
      await peer.close();
    }
  },
);

test(
  "a header set on the redirected request reaches the peer",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The capability the payload is for, and the reason it is a `ClientRequest` rather
    // than a description of one.
    const peer = await redirectingPeer("self/hop");
    const socket = following(peer.url);
    try {
      const applied = new Promise<void>((resolve) => {
        socket.once("redirect", (_url, request) => {
          request.setHeader(MARKER, "second");
          resolve();
        });
      });
      await opened(socket);
      await applied;
      expect(peer.markers).toEqual([undefined, "second"]);
    } finally {
      await settle(socket);
      await peer.close();
    }
  },
);

test(
  "a request destroyed from a redirect listener cancels the hop",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // `ws` documents that destroying the request from a `redirect` listener is the way to
    // stop following, and it is the reason the event carries the request at all.
    const peer = await redirectingPeer("self/never");
    const socket = following(peer.url);
    // A destroyed request reports `socket hang up` on the socket, and `ws` emits that as
    // an `error`; the listener is what keeps it from being thrown.
    socket.on("error", () => undefined);
    try {
      const stopped = new Promise<void>((resolve) => {
        socket.once("redirect", (_url, request) => {
          request.destroy();
          resolve();
        });
      });
      await stopped;
      // The claim is that the hop did not go out, which is what the peer is for: a
      // destroyed request emits no `error` of its own, so there is nothing on the socket
      // to await and asserting the socket's fate would be asserting Node's.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(peer.paths).toEqual(["/"]);
      // The hop that was destroyed never completes, so the socket never opens. Which of
      // the non-open states it lands in is Node's to decide.
      expect(socket.readyState).not.toBe(WebSocket.OPEN);
    } finally {
      await settle(socket);
      await peer.close();
    }
  },
);
