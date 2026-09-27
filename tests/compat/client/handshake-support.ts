//! The teardown every handshake test in this suite needs, and the reason it exists.
//!
//! Its own module because three suites raise the same three sockets in the same order and
//! a teardown that is written three times is a teardown that is fixed once.

import { WebSocket } from "../../../src/index";

/// Tears a socket down and waits until nothing about it is still in flight.
///
/// `terminate()` rather than `close()` because the scripted peers answer the handshake
/// and then nothing, so a close would wait out the whole deadline for a frame that is
/// never coming; these tests are about the handshake, and the teardown should say so.
///
/// The listener goes on before the state check rather than after. A socket that has
/// already closed can still have a transport error in flight from the teardown that
/// closed it, and `ws` emits `error` for a socket-level failure regardless of the ready
/// state. An `error` with no listener is thrown, so a test that returned early here would
/// hand the next one an unhandled exception -- which is how a green suite ends up
/// reporting an `ECONNRESET` with no stack in any of its own tests.
export async function settle(socket: WebSocket): Promise<void> {
  socket.on("error", () => undefined);
  if (socket.readyState !== WebSocket.CLOSED) {
    const done = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.terminate();
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, TEARDOWN_BOUND_MS))]);
  }
  // A socket destroyed on one side is reset on the other, and the reset is reported on
  // the next tick. Draining it here means it lands on this test's own listeners rather
  // than on whichever one runs next.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/// A bound on the teardown, short enough that a socket which does not close does not
/// stall the suite.
const TEARDOWN_BOUND_MS = 500;

/// The close deadline every socket in this file is opened with.
///
/// Short, because the scripted peers answer the handshake and then nothing, so a close
/// would otherwise wait out `ws`'s three-second default for a frame that is never coming.
export const CLOSE_DEADLINE_MS = 120;
