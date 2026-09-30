// The teardown three handshake suites share, so a fix here fixes all.

import { WebSocket } from "../../../src/index";

/// `terminate()` rather than `close()`: the scripted peers answer and then nothing, so a
/// close waits out the deadline. The listener goes on first: a closed socket can still
/// have a transport error in flight, and an `error` with no listener is thrown.
export async function settle(socket: WebSocket): Promise<void> {
  socket.on("error", () => undefined);
  if (socket.readyState !== WebSocket.CLOSED) {
    const done = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.terminate();
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, TEARDOWN_BOUND_MS))]);
  }
  // A one-sided destroy resets next tick, so it is drained here.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const TEARDOWN_BOUND_MS = 500;

/// Short: the scripted peers answer and then nothing.
export const CLOSE_DEADLINE_MS = 120;
