import type { SocketState } from "../../types/socket";
import { emitEvent } from "../events/emitter";
import { createError } from "../errors";
import { CLOSED, CLOSING, OPEN } from "../ready-state";
import { closeCodec } from "./codec-handle";
import { writeCloseFrame } from "./codec-outbound";
import type { Refusal } from "./refusal-table";
import { finishConnection } from "./lifecycle";

const CLOSE_ABNORMAL = 1006;

/// The socket stays `CLOSING` in between, as in `ws`, which is what makes the difference
/// between a close that completed and one that did not observable. The codec is not
/// released: whichever door finishes the socket does that, and releasing it here would
/// drop the close frame still in the transport's buffer.
export function closeFramed(state: SocketState, code: number | undefined, reason: Buffer): void {
  writeCloseFrame(state, code, reason);
}

/// The close frame goes out first: a connection refused without one is a reset to the
/// peer, and a reset cannot carry a code. `error` is emitted before `close`, as `ws`
/// does, and inside a `finally` so a throwing listener cannot leave the socket open.
export function refuseFramed(state: SocketState, refusal: Refusal): void {
  if (state.readyState === CLOSED) return;
  state.readyState = CLOSING;
  writeCloseFrame(state, refusal.closeCode, Buffer.from(refusal.reason, "utf8"));
  try {
    if (!state.errorEmitted) {
      state.errorEmitted = true;
      emitEvent(state, "error", createError(refusal.code, refusal.message, refusal.ctor));
    }
  } finally {
    finishConnection(state, refusal.closeCode, Buffer.from(refusal.reason, "utf8"));
    closeCodec(state);
    state.transport?.end();
  }
}

/// Without it a peer that never answers a close frame leaves the socket at `CLOSING` for
/// the life of the process, holding its transport and its codec slot. `ws` bounds the
/// same wait with `closeTimeout`, and its default of thirty seconds is the one here.

// Zero is "tear down on the next tick", which is what `setTimeout(fn, 0)` does in
// `ws` and what `closeTimeout: 0` asked for. Reading it as "no deadline" turned a
// bounded teardown into a permanent hold, where a `ws` caller saw a clean 1006.
//
// The expiry is a `terminate` rather than a bare `close`: the peer is not answering,
// so the frame will never be read.
export function armCloseTimeout(state: SocketState, milliseconds: number): void {
  clearCloseTimeout(state);
  state.closeTimer = setTimeout(
    () => {
      state.closeTimer = null;
      if (state.readyState !== CLOSING) return;
      state.transport?.destroy();
      finishConnection(state, CLOSE_ABNORMAL, Buffer.alloc(0));
    },
    Math.max(milliseconds, 0),
  );
  // A pending close timer must not be the reason a process stays up.
  state.closeTimer.unref?.();
}

export function clearCloseTimeout(state: SocketState): void {
  if (state.closeTimer === null) return;
  clearTimeout(state.closeTimer);
  state.closeTimer = null;
}

/// Open enough to be closed by a frame, which is where a close deadline means anything.
export function isClosing(state: SocketState): boolean {
  return state.readyState === CLOSING || state.readyState === OPEN;
}
