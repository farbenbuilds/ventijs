//! Reading exact byte counts off a raw socket, without losing the leftovers. The leftover buffer
//! has to be right in exactly one place: dropping it makes the next read start mid-frame.

import type { Socket } from "node:net";

/// A TCP read is not aligned to a frame: one read can carry the tail of a length field and the
/// whole of the payload behind it. A `WeakMap` rather than a property because the state belongs
/// to the reader, and `net.Socket` is somebody else's type.
const LEFTOVER = new WeakMap<Socket, Buffer>();

/// Reads exactly `count` bytes, or rejects on the timeout.
///
/// Serves from the leftovers first, so a caller past the end of a field does not block for bytes that already arrived.
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
