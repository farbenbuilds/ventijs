//! What a `wss:` to `ws:` redirect does, which the two implementations do differently.
//!
//! Measured, not assumed: `ws` follows it. The condition at `websocket.js:846` is one arm
//! of a credential rule, `!isSameHost || (_originalSecure && !isSecure)`, whose second arm
//! only deletes `authorization`, `cookie` and `auth` (`websocket.js:851-856`) before
//! `initAsClient` dials the new hop. ventijs refuses the hop outright (`redirect.ts:66`).
//!
//! The refusal is the safer of the two and it stays, but it is a divergence and a caller
//! migrating has to be able to see it, so both legs run here and the expectation is
//! written down rather than implied.

import { WebSocket as WsSocket } from "ws";
import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { downgradePeer } from "./downgrade-peer";
import { handshakePeer } from "./redirect-peer";
import { certificates } from "./tls-support";
import { undeclared } from "./undeclared";

type Hop = {
  /// `"open"`, or the message of the error that ended the handshake.
  readonly outcome: string;
  readonly url: string;
  readonly hops: readonly string[];
  /// The target the destination peer was asked for, which is what proves the hop was
  /// actually dialled rather than only announced.
  readonly requests: number;
};

type Client = {
  readonly url: string;
  on(event: string, listener: (...args: never[]) => void): void;
  terminate(): void;
};

type Make = (url: string) => Client;

const wsLeg: Make = (url) =>
  new WsSocket(url, undefined, {
    followRedirects: true,
    ca: certificates().ca,
  }) as unknown as Client;

const ventijsLeg: Make = (url) =>
  new WebSocket(
    url,
    undefined,
    undeclared({ followRedirects: true, ca: certificates().ca }),
  ) as unknown as Client;

/// The one scenario: a `wss:` peer that redirects to a `ws:` peer, against either client.
async function hop(make: Make): Promise<Hop> {
  const destination = await handshakePeer();
  const peer = await downgradePeer(destination.url);
  const socket = make(peer.url);
  const hops: string[] = [];
  const outcome = await new Promise<string>((resolve) => {
    socket.on("redirect", (target: never) => hops.push(String(target)));
    socket.on("open", () => resolve("open"));
    socket.on("error", (error: never) => resolve((error as Error).message));
  });
  const seen: Hop = { outcome, url: socket.url, hops, requests: destination.paths.length };
  socket.on("error", () => undefined);
  socket.terminate();
  await peer.close();
  await destination.close();
  return seen;
}

test(
  "ws follows a wss: to ws: redirect and ventijs refuses it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const reference = await hop(wsLeg);
    const ours = await hop(ventijsLeg);

    // `ws`: the downgrade is followed. The hop is announced, the new URL is the plaintext
    // one, and the destination really was dialled.
    expect(reference.outcome).toBe("open");
    expect(reference.hops).toHaveLength(1);
    expect(reference.hops[0]).toMatch(/^ws:\/\//);
    expect(reference.url).toMatch(/^ws:\/\//);
    expect(reference.requests).toBe(1);

    // ventijs: refused before a hop exists, so there is no `redirect` to announce and the
    // destination was never dialled. The socket keeps the URL it was given.
    expect(ours.outcome).toBe("Cannot follow a redirect from wss: to ws:");
    expect(ours.hops).toEqual([]);
    expect(ours.requests).toBe(0);
    expect(ours.url).toMatch(/^wss:\/\//);
  },
);
