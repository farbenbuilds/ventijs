//! `autoPong`, asked and answered.
//!
//! Its own file because the option is one bit with two observable consequences and
//! both have to be pinned: a ping the socket answers on its own, and a ping it leaves
//! for the application. A client that answered when told not to would be a client that
//! lies about a protocol deadline, and one that refused to answer when told to would
//! hang peers whose application never reads `ping`.

import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openWithPeer, waitFor } from "./client-support";
import { undeclared } from "./undeclared";

test(
  "autoPong false leaves the ping for the application to answer",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    // The peer reports the ping; whether this socket answers it is the caller's choice,
    // and the two are different conversations.
    const peerPings: string[] = [];
    const pongs: string[] = [];
    const { socket, harness } = await openWithPeer(
      (peer) => {
        peer.on("ping", (data) => peerPings.push(data.toString()));
        peer.on("pong", (data) => pongs.push(data.toString()));
      },
      undefined,
      undefined,
      undeclared({ autoPong: false }),
    );
    try {
      socket.ping("beat");
      await waitFor(() => peerPings.length === 1);
      // The ping went out and no pong came back, because nothing answered it.
      expect(pongs).toEqual([]);
      socket.pong("answer");
      await waitFor(() => pongs.length === 1);
      expect(pongs[0]).toBe("answer");
      socket.close();
    } finally {
      await harness.close();
    }
  },
);
