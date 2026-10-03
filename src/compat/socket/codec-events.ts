import {
  CODEC_KINDS,
  codecFragmentEnds,
  nextCodecEvent,
  selectCodecEvent,
  selectedCodecEvent,
  takeCodecEvent,
  type CodecFirst,
  type CodecKindName,
} from "../../binding/codec";
import type { SocketState } from "../../types/socket";
import { CLOSED } from "../ready-state";
import { codecOf } from "./codec-handle";
import { dispatch, isDeferrable } from "./codec-dispatch";
import { isDeliveryPaused, pauseUntilNextTick } from "./codec-deferral";

/// Delivers every queued event, control frames first. The synchronous path asks the codec
/// for each event already retired; the deferred path keeps the select/take window because
/// it has to pause before the take. `first` is the event a fused feed already produced.
export function deliver(
  state: SocketState,
  resume: () => void,
  first: CodecFirst | null = null,
): void {
  drain(state, false, resume, first);
}

/// Delivers the event a pause was waiting for, then goes back to the policy. The policy is
/// not re-applied to that event: it has had its decision, so re-applying defers it for
/// ever. One event per tick is what `ws` delivers. `resume` is the caller's own drain
/// rather than a no-op, because the pause taken by the *next* event is what must come back
/// for the queue.
export function drainReleased(state: SocketState, resume: () => void): void {
  drain(state, true, resume, null);
}

function drain(
  state: SocketState,
  released: boolean,
  resume: () => void,
  first: CodecFirst | null,
): void {
  const handle = codecOf(state);
  if (handle === null) return;
  if (isDeliveryPaused(state)) return;
  if (state.allowSynchronousEvents === false) {
    drainDeferred(state, handle, released, resume);
    return;
  }
  if (first !== null) {
    dispatch(
      state,
      handle,
      kindOf(first.kindCode),
      first.kindCode & 0xffff,
      first.payload,
      first.ends,
    );
    if (state.readyState === CLOSED) return;
  }
  for (;;) {
    const next = nextCodecEvent(handle, state.binaryType === "fragments");
    if (next === null) return;
    dispatch(state, handle, kindOf(next[0]), next[0] & 0xffff, next[1], next[2] ?? null);
    if (state.readyState === CLOSED) return;
  }
}

/// `allowSynchronousEvents: false` moves the application's turn to observe a message to a
/// later tick, and stops the drain so the frames behind it are not read until then. The
/// automatic pong is not deferred with it: RFC 6455 section 5.5.2 gives that a deadline
/// and the option does not. Decided *before* the event is taken, because taking retires
/// the slot and deferring after would discard the message the pause is waiting for.
function drainDeferred(
  state: SocketState,
  handle: bigint,
  released: boolean,
  resume: () => void,
): void {
  let honoured = released;
  while (selectCodecEvent(handle)) {
    const event = selectedCodecEvent(handle);
    if (!honoured && isDeferrable(event)) {
      pauseUntilNextTick(state, resume);
      return;
    }
    honoured = false;
    // Read inside the select/take window: the only one where the reassembly buffer is
    // still this message, so fragments are readable here or not at all.
    const ends = codecFragmentEnds(handle);
    takeCodecEvent(handle);
    if (event === null) continue;
    dispatch(state, handle, event.kind, event.code, event.payload, ends);
    if (state.readyState === CLOSED) return;
  }
}

/// The kind and close code share one native slot: the kind is the high 16 bits.
function kindOf(kindCode: number): CodecKindName {
  return CODEC_KINDS[kindCode >>> 16] ?? "rejected";
}
