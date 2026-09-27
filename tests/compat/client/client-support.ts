//! The client suite's shared pieces: a `ws` server, a ventijs client, and a wait.
//!
//! Its own module because the two client suites need the same harness and the
//! harness has one job that is easy to get wrong: every listener a test needs has to
//! exist before the peer speaks, because `open` and `close` are emitted
//! synchronously and a listener attached afterwards never sees the event it was
//! waiting for.

import { WebSocketServer as WsServer, type WebSocket as WsSocket } from "ws";
import { WebSocket, type ClientOptions } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

export type Harness = {
  readonly url: string;
  readonly server: WsServer;
  close(): Promise<void>;
};

export type Peer = WsSocket;

/// A `ws` server, and the first socket it accepts.
///
/// `onPeer` runs for that socket before the promise resolves, so a listener attached
/// there is in place before the test's client has finished its handshake. The peers
/// are tracked because `ws`'s `server.close()` waits for every client to disconnect,
/// and a test whose assertion failed before it closed its client would otherwise hang
/// in `close()` and report a timeout instead of the assertion that actually failed.
export async function wsServer(
  onPeer: (peer: Peer) => void,
): Promise<{ harness: Harness; accepted: Promise<Peer> }> {
  const server = new WsServer({ port: 0 });
  const peers: Peer[] = [];
  const accepted = new Promise<Peer>((resolve) => {
    server.on("connection", (socket) => {
      peers.push(socket);
      onPeer(socket);
      resolve(socket);
    });
  });
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
  });
  return {
    harness: {
      url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
      server,
      close: () => {
        for (const peer of peers) peer.terminate();
        return new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      },
    },
    accepted,
  };
}

/// A ventijs client, resolved once it is open, with `setup` run before the wait.
///
/// `setup` is part of construction rather than something a test does next, because a
/// `ws` peer that sends on connection frames its message before this client's `open`
/// resolves. The codec buffers it, but only a listener that already exists is called
/// when the queue drains.
export function open(
  url: string,
  setup?: (socket: WebSocket) => void,
  protocols?: string | string[],
  options?: ClientOptions,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocols, options);
    socket.on("error", reject);
    socket.on("open", () => resolve(socket));
    setup?.(socket);
  });
}

/// A client plus the peer that accepted it, which is what a test that needs both
/// ends of one conversation wants.
export async function openWithPeer(
  onPeer: (peer: Peer) => void,
  setup?: (socket: WebSocket) => void,
  protocols?: string | string[],
  options?: ClientOptions,
): Promise<{ socket: WebSocket; peer: Peer; harness: Harness }> {
  const { harness, accepted } = await wsServer(onPeer);
  const socket = await open(harness.url, setup, protocols, options);
  return { socket, peer: await accepted, harness };
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

/// Resolves on the socket's `error`, which is how a refused handshake is observed.
///
/// The `close` event matters as much as the `error` and is a separate promise on
/// purpose. Asserting `readyState` after the `error` proved nothing: the ready state
/// was `CLOSED` even on a socket whose `close` event had never been dispatched, because
/// the abort path latched the terminal state itself and then skipped the dispatch. A
/// caller that awaits `close` is the ordinary shape, and it hung.
export function failed(socket: WebSocket): Promise<Error> {
  return new Promise((resolve) => {
    socket.on("error", resolve);
  });
}

export function closed(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
  });
}

/// Resolves on the next `unexpected-response`, carrying the status the peer sent.
///
/// A promise rather than a poll because a listener takes the refusal over: there is no
/// `error` and no `close` to await on a socket a caller has taken responsibility for.
export function refused(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("unexpected-response", (_url, status) => resolve(status));
  });
}
