//! The upgrade-route harness: a ventiws server behind a real HTTP upgrade, plus the
//! peer a test drives it with.
//!
//! Its own module because both suites need it and it is the part that decides whether
//! a test means anything: the `WebSocketServer` here is ventiws's own, so the sockets
//! are the facade's and the frames on them are the codec's.

import type { AddressInfo } from "node:net";
import { WebSocket as WsClient } from "ws";
import { WebSocketServer, type WebSocket } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { serve } from "../server/upgrade-support";

export type Harness = {
  readonly url: string;
  readonly port: number;
  readonly server: WebSocketServer;
  close(): Promise<void>;
};

/// A harness over a `noServer` server the caller configured, so a test that is about
/// one server option can set it and still be reading real frames.
///
/// The default is a plain `noServer` server because most cases are about the codec
/// rather than about the options; the ones that are about an option pass their own.
export async function upgradeHarness(server?: WebSocketServer): Promise<Harness> {
  const owned = new WebSocketServer({ noServer: true });
  const target = server ?? owned;
  const harness = await serve(target);
  void (harness.httpServer.address() as AddressInfo | null);
  return {
    url: `ws://127.0.0.1:${harness.port}`,
    port: harness.port,
    server: target,
    close: harness.close,
  };
}

/// A `ws` client, resolved once its handshake is done.
///
/// The options are the caller's because `perMessageDeflate` is the one that changes what
/// the peer offers, and a test that wants an uncompressed client has to say so rather
/// than accept whatever the default is.
export function openClient(url: string, options?: WsClient.ClientOptions): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const client = new WsClient(url, options);
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

/// The one socket a server accepted.
export function nextSocket(server: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve) => {
    server.once("connection", (socket) => resolve(socket));
  });
}

/// Resolves once `condition` holds, or rejects when it stops being worth waiting for.
export function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TEST_TIMEOUT_MS;
    const poll = (): void => {
      if (condition()) return resolve();
      if (Date.now() > deadline) return reject(new Error("condition unmet within the timeout"));
      setTimeout(poll, 5);
    };
    poll();
  });
}
