//! Reading exact byte counts off a raw socket, without losing the leftovers.
//!
//! Split out of `raw-peer.ts` because this is a stream concern and a frame is a protocol
//! concern, and because the leftover buffer is state that has to be right in exactly one
//! place: a reader that drops the bytes past the last frame boundary turns the next read
//! into the middle of a frame, and the symptom is a test asserting on a header the peer
//! never wrote.

import type { Socket } from "node:net";

/// The bytes already read past the last frame boundary, per socket.
///
/// A TCP read is not aligned to a frame: one read can carry the tail of a length field
/// and the whole of the payload behind it. Without somewhere to keep those leftovers
/// they are dropped, and the next read starts mid-frame -- which surfaces as a test
/// asserting on a header or a length the peer never wrote. A `WeakMap` rather than a
/// property because the state belongs to the reader, not to the socket, and `net.Socket`
/// is somebody else's type.
const LEFTOVER = new WeakMap<Socket, Buffer>();

/// Reads exactly `count` bytes, or rejects on the timeout.
///
/// Serves from the leftovers first, so a caller that has already read past the end of a
/// field gets the rest of the stream rather than blocking for bytes that already
/// arrived.
export function read(socket: Socket, count: number): Promise<Buffer> {
  const buffered = LEFTOVER.get(socket);
  if (buffered !== undefined && buffered.length >= count) {
    LEFTOVER.set(socket, buffered.subarray(count));
    return Promise.resolve(buffered.subarray(0, count));
  }
  return new Promise((resolve, reject) => {
    let data = buffered ?? Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      data = Buffer.concat([data, chunk]);
      if (data.length < count) return;
      settle(() => {
        LEFTOVER.set(socket, data.subarray(count));
        resolve(data.subarray(0, count));
      });
    };
    const onError = (error: Error): void => settle(() => reject(error));
    const settle = (done: () => void): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      done();
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}
