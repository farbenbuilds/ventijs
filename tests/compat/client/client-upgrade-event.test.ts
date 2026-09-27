//! The `upgrade` event, and the order it fires in.
//!
//! Split out of `client-handshake-events.test.ts` because it is the only one of the three
//! that is about a *successful* handshake, and its one load-bearing property is the order:
//! `ws` emits the response before it checks anything, so a listener may close the socket
//! from it. A validation failure ahead of the event would make the event unobservable on
//! exactly the responses a caller most wants to inspect.

import type { IncomingMessage } from "node:http";
import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { scriptedPeer } from "./redirect-peer";
import { CLOSE_DEADLINE_MS, settle } from "./handshake-support";
import { undeclared } from "./undeclared";

test("upgrade reports the 101 before the socket opens", { timeout: TEST_TIMEOUT_MS }, async () => {
  // `ws` emits this first and lets a listener close the socket from it, which is why
  // the order is asserted rather than the event alone: a validation failure before the
  // event would make the event unobservable on exactly the responses a caller most
  // wants to see.
  const peer = await scriptedPeer({ first: 101, after: 101 });
  const socket = new WebSocket(
    peer.url,
    undefined,
    undeclared({ closeTimeout: CLOSE_DEADLINE_MS }),
  );
  try {
    const seen = new Promise<IncomingMessage>((resolve) => {
      socket.once("upgrade", resolve);
    });
    await new Promise<void>((resolve) => socket.once("open", resolve));
    const response = await seen;
    expect(response.statusCode).toBe(101);
    expect(response.headers.upgrade).toBe("websocket");
  } finally {
    await settle(socket);
    await peer.close();
  }
});

test(
  "a listener that closes from upgrade leaves the socket closed",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The reason the event comes before the checks. A caller that saw the 101 and closed
    // has answered the question the event exists for; attaching a codec anyway would
    // emit `open` on a socket it had just closed.
    //
    // The `error` listener is not optional: closing a `CONNECTING` socket reports the
    // aborted handshake as an `error`, and an `error` with no listener throws out of the
    // emit -- which would abort the rest of this listener, including the `resolve` the
    // test is waiting on.
    const peer = await scriptedPeer({ first: 101, after: 101 });
    const socket = new WebSocket(
      peer.url,
      undefined,
      undeclared({ closeTimeout: CLOSE_DEADLINE_MS }),
    );
    try {
      // Attached before the close below, because closing a `CONNECTING` socket reports
      // the aborted handshake as an `error` and an `error` with no listener is thrown
      // from inside the listener that is running.
      const reported = new Promise<Error>((resolve) => socket.once("error", resolve));
      const seen = new Promise<void>((resolve) => {
        socket.once("upgrade", () => {
          socket.close();
          resolve();
        });
      });
      await seen;
      expect(socket.readyState).toBe(WebSocket.CLOSED);
      expect((await reported).message).toMatch(/closed before the connection was established/);
    } finally {
      socket.on("error", () => undefined);
      await peer.close();
    }
  },
);
