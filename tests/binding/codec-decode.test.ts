//! What a peer sends is decoded into the right events.
//!
//! The frames here are built by the fixture rather than by the codec's own encoder,
//! so a decoder that is wrong in a symmetric way still fails: the expected outcome
//! comes from RFC 6455, not from the code under test.

import { expect, test } from "vitest";
import {
  CODEC_KINDS,
  CODEC_ROLE,
  createCodec,
  destroyCodec,
  feedCodec,
} from "../../src/binding/codec";
import { clientFrames, closePayload, drain } from "./codec-frames";

const PING = CODEC_KINDS.indexOf("ping");
const CLOSE = CODEC_KINDS.indexOf("close");

/// A server-role codec on the compiled capacity, released afterwards.
function serverCodec(): bigint {
  return createCodec(CODEC_ROLE.server);
}

test("masked frames decode to the events a server owes a peer", () => {
  const handle = serverCodec();
  try {
    const ping = clientFrames([{ opcode: 0x9, payload: Buffer.from("beat") }]);
    const text = clientFrames([{ opcode: 0x1, payload: Buffer.from("hello") }]);
    const close = clientFrames([{ opcode: 0x8, payload: closePayload(1000, "bye") }]);

    // A ping is a control frame, so it comes out ahead of the message behind it: a
    // ping the caller has not answered has a deadline the rest of the queue does not.
    // A close is a control frame too, and it does *not* overtake: `close` is terminal,
    // so delivering it first ends the socket and drops a message the peer sent before
    // it. A peer that writes a message and a close in one read is how every
    // application says goodbye, which makes this the queue where the ordering is most
    // observable -- and it used to deliver `close` first and lose the message.
    const fed = feedCodec(handle, Buffer.concat([ping, text, close]));
    expect(fed).toEqual({ kind: "consumed", bytes: ping.length + text.length + close.length });
    const events = drain(handle);
    expect(events.map((event) => event.kind)).toEqual(["ping", "text", "close"]);
    expect(events[0]?.payload.toString()).toBe("beat");
    expect(events[1]?.payload.toString()).toBe("hello");
    expect(events[2]?.code).toBe(1000);
    // The reason is what is left after the code, not the whole payload.
    expect(events[2]?.payload.toString()).toBe("bye");
  } finally {
    destroyCodec(handle);
  }
});

test("a frame split across reads decodes once the last byte arrives", () => {
  const handle = serverCodec();
  try {
    const frames = clientFrames([{ opcode: 0x1, payload: Buffer.from("split me") }]);
    // Every byte is consumed as it arrives, including the last: the frame is emitted
    // on a turn after the payload, and that turn reports no further input.
    for (let index = 0; index < frames.length; index += 1) {
      const piece = frames.subarray(index, index + 1);
      expect(feedCodec(handle, piece)).toEqual({ kind: "consumed", bytes: 1 });
    }
    expect(drain(handle).map((event) => event.payload.toString())).toEqual(["split me"]);
  } finally {
    destroyCodec(handle);
  }
});

test("a text frame and a binary frame are two different events", () => {
  // 0xff is never valid UTF-8, which is exactly why binary exists: the same bytes in
  // a text frame are refused. Two codecs, because a refusal ends a connection.
  const bytes = [0xff, 0xfe];
  const refused = serverCodec();
  try {
    const text = clientFrames([{ opcode: 0x1, payload: Buffer.from(bytes) }]);
    expect(feedCodec(refused, text)).toEqual({ kind: "failed" });
  } finally {
    destroyCodec(refused);
  }

  const accepted = serverCodec();
  try {
    const binary = clientFrames([{ opcode: 0x2, payload: Buffer.from(bytes) }]);
    expect(feedCodec(accepted, binary)).toEqual({ kind: "consumed", bytes: binary.length });
    const events = drain(accepted);
    expect(events.map((event) => event.kind)).toEqual(["binary"]);
    const only = events[0];
    expect(only === undefined ? [] : [...only.payload]).toEqual(bytes);
  } finally {
    destroyCodec(accepted);
  }
});

test("a control frame is not a message", () => {
  const handle = serverCodec();
  try {
    const frames = clientFrames([{ opcode: 0x9, payload: Buffer.from("beat") }]);
    expect(feedCodec(handle, frames)).toEqual({ kind: "consumed", bytes: frames.length });
    expect(drain(handle).map((event) => event.kind)).toEqual([CODEC_KINDS[PING]]);
  } finally {
    destroyCodec(handle);
  }
});

test("an empty close payload is a close with no code", () => {
  const handle = serverCodec();
  try {
    const frames = clientFrames([{ opcode: 0x8, payload: Buffer.alloc(0) }]);
    expect(feedCodec(handle, frames)).toEqual({ kind: "consumed", bytes: frames.length });
    const events = drain(handle);
    expect(events.map((event) => event.kind)).toEqual([CODEC_KINDS[CLOSE]]);
    expect(events[0]?.code).toBe(0);
    expect(events[0]?.payload.length).toBe(0);
  } finally {
    destroyCodec(handle);
  }
});
