//! The teardown every handshake test in this suite needs. Its own module because three suites
//! raise the same three sockets in the same order, and a teardown fixed once is fixed everywhere.

import { WebSocket } from "../../../src/index";

/// `terminate()` rather than `close()`: the scripted peers answer the handshake and then nothing,
/// so a close waits out the whole deadline for a frame that is never coming. The listener goes
/// on before the state check, because a socket already closed can still have a transport error
/// in flight and an `error` with no listener is thrown.
export async function settle(socket: WebSocket): Promise<void> {
  socket.on("error", () => undefined);
  if (socket.readyState !== WebSocket.CLOSED) {
    const done = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.terminate();
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, TEARDOWN_BOUND_MS))]);
  }
  // The reset from a one-sided destroy lands on the next tick, so it is drained here rather than on whichever test runs next.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/// A bound on the teardown, short enough that a socket which does not close does not
/// stall the suite.
const TEARDOWN_BOUND_MS = 500;

/// Short, because the scripted peers answer the handshake and then nothing.
export const CLOSE_DEADLINE_MS = 120;
