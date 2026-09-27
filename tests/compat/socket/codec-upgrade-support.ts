//! The upgrade-route harness: a ventijs server behind a real HTTP upgrade, plus the
//! peer a test drives it with.
//!
//! Its own module because both suites need it and it is the part that decides whether
//! a test means anything: the `WebSocketServer` here is ventijs's own, so the sockets
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

export async function upgradeHarness(): Promise<Harness> {
  const server = new WebSocketServer({ noServer: true });
  const harness = await serve(server);
  void (harness.httpServer.address() as AddressInfo | null);
  return {
    url: `ws://127.0.0.1:${harness.port}`,
    port: harness.port,
    server,
    close: harness.close,
  };
}

/// A `ws` client, resolved once its handshake is done.
export function openClient(url: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const client = new WsClient(url);
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
