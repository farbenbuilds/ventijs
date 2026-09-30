// A listener a codec test can read frames from, and a `ws` client it can read from.
//
// The buffering is the point. A peer that writes the instant its handshake
// completes delivers its first bytes before a test has attached a reader, and those
// bytes are then gone rather than late, so a test fails for a reason that has
// nothing to do with the codec.

import { createServer, type Socket } from "node:net";
import { WebSocket as WsClient } from "ws";
import { readHandshake, TEST_TIMEOUT_MS, writeAccept } from "./codec-net";

export type RawPeer = {
  readonly port: number;
  /// The peer's bytes so far, including any it sent before the first read.
  readonly received: () => Buffer;
  /// Resolves with everything the peer sent since the last read.
  read(): Promise<Buffer>;
  send(bytes: Buffer): Promise<void>;
  close(): Promise<void>;
};

/// A TCP listener that answers the opening handshake and buffers what the peer sends.
export function startRawPeer(): Promise<RawPeer> {
  const sockets: Socket[] = [];
  let buffered: Buffer = Buffer.alloc(0);
  let waiters: Array<() => void> = [];
  let opened: (socket: Socket) => void = () => undefined;
  const connected = new Promise<Socket>((ready) => {
    opened = ready;
  });

  const notify = (): void => {
    if (buffered.length === 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  const listener = createServer((socket) => {
    sockets.push(socket);
    // The handshake has a reader of its own, so the buffer stands aside until it is
    // done: the codec's input begins at the first frame, not at the request line.
    let handshaking = true;
    socket.on("data", (chunk: Buffer) => {
      if (handshaking) return;
      buffered = Buffer.concat([buffered, chunk]);
      notify();
    });
    void (async () => {
      const { key, head } = await readHandshake(socket);
      writeAccept(socket, key);
      handshaking = false;
      // A frame can share a read with the request, so the leftover is the first
      // thing the codec sees.
      if (head.length > 0) {
        buffered = head;
        notify();
      }
      opened(socket);
    })();
  });

  return new Promise((resolve) => {
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : 0,
        received: () => buffered,
        read: () => take(),
        send: async (bytes) => {
          const socket = await connected;
          socket.write(bytes);
        },
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            listener.close(() => done());
          }),
      });
    });
  });

  /// The buffered bytes, or a waiter for the next ones.
  function take(): Promise<Buffer> {
    if (buffered.length > 0) {
      const chunk = buffered;
      buffered = Buffer.alloc(0);
      return Promise.resolve(chunk);
    }
    return new Promise<Buffer>((ready, reject) => {
      const timer = setTimeout(
        () => reject(new Error("peer idle within the timeout")),
        TEST_TIMEOUT_MS,
      );
      waiters.push(() => {
        clearTimeout(timer);
        const chunk = buffered;
        buffered = Buffer.alloc(0);
        ready(chunk);
      });
    });
  }
}

/// A `ws` client that has finished its handshake.
///
/// Awaiting the open event rather than constructing and sending is not a style
/// choice: `send` on a connecting socket throws, so a test that skips this fails for
/// a reason that has nothing to do with the codec.
export function openClient(url: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const client = new WsClient(url);
    client.once("open", () => resolve(client));
    client.once("error", reject);
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
