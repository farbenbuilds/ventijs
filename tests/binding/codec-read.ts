// Waiting for bytes off a socket, in one place.
//
// Its own file because the shape is the same every time — accumulate, resolve at a
// threshold, stop listening, and clear the timer — and three copies of it would be
// three places for a leak to hide.

import type { Socket } from "node:net";
import { TEST_TIMEOUT_MS } from "./codec-net";

/// Reads until at least `count` bytes have arrived, or the timeout expires.
export function readBytes(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered: Buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.off("data", onData);
      reject(new Error(`only ${buffered.length} of ${count} bytes arrived within the timeout`));
    }, TEST_TIMEOUT_MS);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < count) return;
      clearTimeout(timer);
      socket.off("data", onData);
      resolve(buffered);
    };
    socket.on("data", onData);
    socket.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
