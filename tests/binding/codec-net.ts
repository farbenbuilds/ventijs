//! The socket half of the codec fixtures.
//!
//! The codec never sees a socket, so a test that wants its bytes read by an
//! independent implementation has to do the handshake itself. These helpers speak
//! the opening handshake in both directions and nothing else, so a test file holds
//! frames rather than HTTP.

import { connect, type Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";

export const TEST_TIMEOUT_MS = 20_000;

/// The `Sec-WebSocket-Accept` a server has to answer with, per RFC 6455.
export function acceptValue(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

/// A handshake split into the request and whatever followed it in the same read.
export type Handshake = {
  /// The bytes after the blank line: the frame stream, which is all the codec sees.
  readonly head: Buffer;
  /// The `Sec-WebSocket-Key` the peer chose.
  readonly key: string;
};

/// Reads an opening handshake off a socket and leaves the socket at the frames.
export function readHandshake(socket: Socket): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    let buffered: Buffer = Buffer.alloc(0);
    const timer = setTimeout(
      () => reject(new Error("no handshake within the timeout")),
      TEST_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      const request = buffered.subarray(0, end).toString("latin1");
      const key = /sec-websocket-key: (.+)\r\n/i.exec(request)?.[1]?.trim();
      if (key === undefined) {
        reject(new Error("handshake carried no Sec-WebSocket-Key"));
        return;
      }
      resolve({ head: buffered.subarray(end + 4), key });
    };
    const onError = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

/// Answers a handshake so a `ws` client believes it is connected.
export function writeAccept(socket: Socket, key: string): void {
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue(key)}`,
      "",
      "",
    ].join("\r\n"),
  );
}

/// Reads a response's head off a socket, leaving the socket at the frame stream.
///
/// The mirror of `readHandshake`, for a client that wrote the request itself: a
/// `ws` server's 101 carries no `Sec-WebSocket-Key`, so the two cannot be one
/// function.
export function readResponse(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered: Buffer = Buffer.alloc(0);
    const timer = setTimeout(
      () => reject(new Error("no response within the timeout")),
      TEST_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      clearTimeout(timer);
      socket.off("data", onData);
      resolve(buffered.subarray(end + 4));
    };
    socket.on("data", onData);
    socket.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/// Opens a TCP connection, for the tests that speak the protocol themselves.
export function openSocket(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1" }, () => resolve(socket));
    socket.on("error", reject);
  });
}

/// A client handshake written by hand, so a test can put its own bytes on the wire.
///
/// `ws` re-frames anything passed to `send`, so a test that wants a `ws` peer to
/// read *its* frame has to do the handshake and write the socket itself. Sixteen
/// random bytes is the key length RFC 6455 requires: a shorter or unpadded one is a
/// 400 before any framing is discussed.
export async function openRawClient(port: number): Promise<Socket> {
  const socket = await openSocket(port);
  socket.write(
    [
      "GET / HTTP/1.1",
      "Host: 127.0.0.1",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"),
  );
  await readResponse(socket);
  return socket;
}
