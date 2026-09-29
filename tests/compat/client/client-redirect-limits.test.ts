//! The hop limit, measured instead of reasoned about.
//!
//! The two implementations put the comparison on opposite sides of the increment: `ws`
//! increments and then compares (`websocket.js:911`), ventiws compares and only creates a
//! hop afterwards (`redirect.ts:46`). Whether that is a divergence is not decidable by
//! reading either one, so the fixture is a chain that never ends and the assertion is how
//! many requests the peer actually received.

import { WebSocket as WsSocket } from "ws";
import { expect, test } from "vitest";
import { WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { scriptedPeer } from "./redirect-peer";
import { undeclared } from "./undeclared";

/// What one leg observed: the outcome the caller saw, the requests the peer served, and
/// the `redirect` events the caller was told about before it gave up.
type Leg = {
  readonly outcome: string;
  readonly served: number;
  readonly hops: number;
};

type Client = {
  on(event: string, listener: (...args: never[]) => void): void;
  terminate(): void;
};

type Make = (url: string, maxRedirects: number | undefined) => Client;

/// `ws` merges options by spreading them, so an explicit `undefined` overwrites its own
/// default of 10 with nothing and the limit stops existing. Omitting the key is the only
/// way to ask either implementation for its default.
function redirectOptions(maxRedirects: number | undefined): Record<string, unknown> {
  if (maxRedirects === undefined) return { followRedirects: true };
  return { followRedirects: true, maxRedirects };
}

/// The one scenario, run against whichever client `make` builds: a peer that answers every
/// request with another redirect to itself, which is the only shape that reaches the limit.
async function chain(make: Make, maxRedirects: number | undefined): Promise<Leg> {
  const peer = await scriptedPeer({ first: 302, location: "self/", after: 302 });
  const socket = make(peer.url, maxRedirects);
  let hops = 0;
  const outcome = await new Promise<string>((resolve) => {
    socket.on("redirect", () => {
      hops += 1;
    });
    socket.on("open", () => resolve("open"));
    socket.on("error", (error: never) => resolve((error as Error).message));
  });
  // A `terminate` on a socket that never opened reports the aborted handshake, so the
  // teardown has to be listening for it.
  socket.on("error", () => undefined);
  socket.terminate();
  const served = peer.paths.length;
  await peer.close();
  return { outcome, served, hops };
}

const wsLeg: Make = (url, maxRedirects) =>
  new WsSocket(url, undefined, redirectOptions(maxRedirects)) as unknown as Client;

const ventiwsLeg: Make = (url, maxRedirects) =>
  new WebSocket(url, undefined, undeclared(redirectOptions(maxRedirects))) as unknown as Client;

test.each([
  { label: "0", maxRedirects: 0, served: 1 },
  { label: "1", maxRedirects: 1, served: 2 },
  { label: "4", maxRedirects: 4, served: 5 },
  // The default is 10 in both (`websocket.js:679`, `options/client.ts:26`), so 11 requests.
  { label: "the default", maxRedirects: undefined, served: 11 },
])(
  "a chain of redirects follows maxRedirects $label hops and then refuses",
  { timeout: TEST_TIMEOUT_MS },
  async ({ maxRedirects, served }) => {
    const reference = await chain(wsLeg, maxRedirects);
    const ours = await chain(ventiwsLeg, maxRedirects);
    // The limit is counted in requests, not in events: the request that earned the refusal
    // was already sent, so `maxRedirects` hops means `maxRedirects + 1` requests.
    expect(reference.served).toBe(served);
    expect(reference.hops).toBe(served - 1);
    expect(ours).toEqual(reference);
    expect(ours.outcome).toBe("Maximum redirects exceeded");
  },
);
