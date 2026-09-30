// The stream harness: a real server per implementation, and the normalization both legs
// are compared through.
//
// The stub this replaced answered `send` and `close` from memory, so it could not show
// either thing these tests exist for: an object-mode conversion decided by the readable
// side, and a `finish` that has to land before the close handshake has completed. Both are
// orderings on a live connection, so both legs are real servers now.

import type { Duplex, DuplexOptions } from "node:stream";
import {
  type WebSocket as UpstreamSocket,
  WebSocket as UpstreamClient,
  WebSocketServer as UpstreamServer,
  createWebSocketStream as upstreamStream,
} from "ws";
import { WebSocketServer, createWebSocketStream } from "../../src/index";
import type { WebSocket } from "../../src/types/ws";
import { nextSocket, openClient } from "../compat/socket/codec-upgrade-support";
import { serve } from "../compat/server/upgrade-support";

/// What two implementations can be compared on: the events a caller would see, in order.
export type Transcript = string[];

/// The server-side socket, narrowed to what a scenario observes of it.
export type Watched = {
  on(event: "close", handler: (code: number, reason: Buffer) => void): unknown;
  terminate(): void;
  readonly isPaused: boolean;
};

export type StreamFixture = {
  /// The stream under test, already bound to the socket the server accepted.
  readonly stream: Duplex;
  readonly socket: Watched;
  /// The peer that drives the scenario.
  readonly client: UpstreamClient;
  readonly dispose: () => Promise<void>;
};

/// Loopback plus slack. It bounds a wait rather than an operation, so it is not a
/// correctness number: a leg that has not finished by then hands back the transcript that
/// shows which event is missing.
const WINDOW_MS = 2_000;
const POLL_MS = 5;

/// The `ws` reference: a real `ws` server, the socket it accepts, and `ws`'s own stream.
export async function upstreamFixture(options?: DuplexOptions): Promise<StreamFixture> {
  const server = new UpstreamServer({ port: 0 });
  const accepted = new Promise<UpstreamSocket>((resolve) => {
    server.on("connection", (socket) => resolve(socket));
  });
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const client = new UpstreamClient(`ws://127.0.0.1:${port}/`);
  client.on("error", () => {});
  // The server accepts on the 101 it writes, which is before the client has read it, so a
  // scenario that sends has to wait for the client's own `open` and not infer it.
  const opened = new Promise<void>((resolve) => {
    client.once("open", resolve);
  });
  const socket = await accepted;
  await opened;
  return {
    stream: upstreamStream(socket, options),
    socket,
    client,
    dispose: async () => {
      client.terminate();
      socket.terminate();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/// The same shape over ventiws's own `WebSocketServer`, so the sockets are the facade's and
/// the frames on them are the codec's rather than a test's.
export async function ventiwsFixture(options?: DuplexOptions): Promise<StreamFixture> {
  const server = new WebSocketServer({ noServer: true });
  const accepted = nextSocket(server);
  const harness = await serve(server);
  const client = await openClient(`ws://127.0.0.1:${harness.port}/`);
  const socket: WebSocket = await accepted;
  return {
    stream: createWebSocketStream(socket, options),
    socket,
    client,
    dispose: async () => {
      client.terminate();
      socket.terminate();
      await harness.close();
    },
  };
}

/// A chunk as the caller sees it. The type is half the transcript: a text message under
/// `readableObjectMode` is the only chunk whose type a caller can tell apart.
export function describeChunk(chunk: unknown): string {
  if (typeof chunk === "string") return `string:${chunk}`;
  if (Buffer.isBuffer(chunk)) return `buffer:${chunk.toString()}`;
  return `other:${String(chunk)}`;
}

export function within(settled: Promise<void>, what: string): Promise<void> {
  const late = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), WINDOW_MS);
    timer.unref?.();
  });
  return Promise.race([settled, late]);
}

export function until(seen: Transcript, label: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (!seen.includes(label)) return;
      clearInterval(poll);
      resolve();
    }, POLL_MS);
    setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, WINDOW_MS).unref?.();
  });
}
