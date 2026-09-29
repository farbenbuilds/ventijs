//! What a server-side socket reports for `url`.
//!
//! `ws` assigns `_url` in one place, `initAsClient` (`websocket.js:719`), so a socket a
//! server accepted never gets one and the getter returns `undefined`
//! (`websocket.js:190`) — while `@types/ws` declares `readonly url: string`, so the
//! reference runtime and its own types disagree. ventiws's state record starts `url` at
//! `""` (`src/compat/socket/state.ts:40`).
//!
//! Recorded rather than fixed. The honest type is `string | undefined`, and that means
//! changing `SocketState.url` and the record's getter, neither of which this suite owns.

import { WebSocket as WsSocket, WebSocketServer as WsServer } from "ws";
import { expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

type Server = {
  once(event: string, listener: (arg: never) => void): void;
  address(): { port: number } | string | null;
  close(done: () => void): void;
};

type Client = { once(event: string, listener: () => void): void; terminate(): void };

type Peer = { url: string; terminate(): void };
/// A server and the client that dials it, so one leg of the comparison is one pair.
type Leg = [Server, (port: number) => Client];

/// Connects a client to a fresh server, hands back what the accepted socket reports for
/// `url`, and tears both ends down. The `connection` listener is registered before the
/// client is constructed, because a local handshake can land before anything is waiting.
async function reported(make: () => Leg): Promise<{ url: string; present: boolean }> {
  const [server, clientFor] = make();
  const connected = new Promise<Peer>((resolve) => {
    server.once("connection", (peer: never) => resolve(peer));
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const client = clientFor((server.address() as { port: number }).port);
  const peer = await connected;
  await new Promise<void>((resolve) => client.once("open", () => resolve()));
  const seen = { url: peer.url, present: "url" in peer };
  client.terminate();
  peer.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return seen;
}

test(
  "a server socket reports undefined in ws and an empty string in ventiws",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const reference = await reported(() => [
      new WsServer({ port: 0 }) as unknown as Server,
      (port) => new WsSocket(`ws://127.0.0.1:${port}/`) as unknown as Client,
    ]);
    const ours = await reported(() => [
      new WebSocketServer({ port: 0 }) as unknown as Server,
      (port) => new WebSocket(`ws://127.0.0.1:${port}/`) as unknown as Client,
    ]);

    // The key exists on both, so `("url" in socket)` cannot tell a caller which library it
    // is holding; only the value does.
    expect(reference.present).toBe(true);
    expect(reference.url).toBeUndefined();
    expect(ours.present).toBe(true);
    expect(ours.url).toBe("");
  },
);
