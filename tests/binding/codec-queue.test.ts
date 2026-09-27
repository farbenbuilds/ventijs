//! The event queue: what fits, what waits, and where a caller resumes.
//!
//! The queue's bound is the codec's memory bound. A control payload is capped at 125
//! bytes so a ring of them is cheap, and a data message's payload borrows the single
//! reassembly buffer so only one of those can be waiting. These are the tests that
//! say so.

import { expect, test } from "vitest";
import {
  CODEC_ROLE,
  codecFeedResume,
  createCodec,
  destroyCodec,
  feedCodec,
  pendingCodecEvents,
  selectCodecEvent,
} from "../../src/binding/codec";
import { clientFrames, drain, MASKED_HEADER_BYTES } from "./codec-frames";

function serverCodec(): bigint {
  return createCodec(CODEC_ROLE.server);
}

test("a queue with nothing in it selects nothing", () => {
  const handle = serverCodec();
  try {
    expect(pendingCodecEvents(handle)).toBe(0);
    expect(selectCodecEvent(handle)).toBe(false);
  } finally {
    destroyCodec(handle);
  }
});

test("every control event in one read keeps its own payload", () => {
  // The receive state machine has one control buffer, so a ring that stored a slice
  // into it would hand the caller the newest frame's bytes for every event. One read
  // of four pings is the order that exposes it.
  const handle = serverCodec();
  try {
    const payloads = ["one", "two", "three", "four"];
    const frames = clientFrames(
      payloads.map((payload) => ({ opcode: 0x9, payload: Buffer.from(payload) })),
    );
    expect(feedCodec(handle, frames)).toEqual({ kind: "consumed", bytes: frames.length });
    expect(pendingCodecEvents(handle)).toBe(payloads.length);
    expect(drain(handle).map((event) => event.payload.toString())).toEqual(payloads);
  } finally {
    destroyCodec(handle);
  }
});

test("one data message at a time, and the offset a second one waits at", () => {
  const handle = serverCodec();
  try {
    const first = clientFrames([{ opcode: 0x1, payload: Buffer.from("one") }]);
    const second = clientFrames([{ opcode: 0x1, payload: Buffer.from("two") }]);
    const together = Buffer.concat([first, second]);
    // A queued message's payload points into the reassembly buffer, so a second one
    // would overwrite the first and the caller would read one message as another.
    expect(feedCodec(handle, together)).toEqual({ kind: "backpressure" });
    // The second frame's header was taken before the queue was found full, so the
    // offset is the end of that header rather than the start of the frame.
    expect(codecFeedResume(handle)).toBe(first.length + MASKED_HEADER_BYTES);
    expect(pendingCodecEvents(handle)).toBe(1);
    expect(drain(handle).map((event) => event.payload.toString())).toEqual(["one"]);

    // Draining the slot is what lets the waiting frame through, and it arrives
    // intact rather than sharing storage with the message just taken.
    const rest = together.subarray(codecFeedResume(handle));
    expect(feedCodec(handle, rest)).toEqual({
      kind: "consumed",
      bytes: second.length - MASKED_HEADER_BYTES,
    });
    expect(drain(handle).map((event) => event.payload.toString())).toEqual(["two"]);
  } finally {
    destroyCodec(handle);
  }
});
