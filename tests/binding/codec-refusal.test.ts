//! What a peer is refused for, and what the caller learns about it.
//!
//! A refusal is the half of the contract a hostile peer exercises, so each case here
//! is a frame RFC 6455 forbids, the close code it maps to, and the offset a caller
//! resumes from.

import { expect, test } from "vitest";
import {
  CODEC_KINDS,
  CODEC_ROLE,
  codecFailureCode,
  createCodec,
  destroyCodec,
  feedCodec,
} from "../../src/binding/codec";
import { engineLimits } from "../../src/binding/server";
import { clientFrames, drain } from "./codec-frames";

const REJECTED = CODEC_KINDS.indexOf("rejected");

/// A codec for one role. The capacity is the compiled one, so a message over it is
/// what a refusal case has to build.
function codecAt(role: number): bigint {
  return createCodec(role);
}

test("a server refuses an unmasked frame with 1002", () => {
  const handle = codecAt(CODEC_ROLE.server);
  try {
    // A `ws` client always masks, so this is the discipline a server exists to
    // enforce, and the code is the RFC's "protocol error".
    const unmasked = Buffer.from([0x81, 0x02, 0x68, 0x69]);
    expect(feedCodec(handle, unmasked)).toEqual({ kind: "failed" });
    // The event says a frame was refused; the code it maps to is latched on the
    // codec, because one refusal ends the connection rather than one message.
    expect(drain(handle).map((event) => event.kind)).toEqual([CODEC_KINDS[REJECTED]]);
    expect(codecFailureCode(handle)).toBe(1002);
  } finally {
    destroyCodec(handle);
  }
});

test("a client refuses a masked frame with 1002", () => {
  const handle = codecAt(CODEC_ROLE.client);
  try {
    // The mirror of the case above: the same bytes a server accepts are the ones a
    // client must reject, so the two roles are not interchangeable.
    const masked = clientFrames([{ opcode: 0x1, payload: Buffer.from("masked") }]);
    expect(feedCodec(handle, masked)).toEqual({ kind: "failed" });
    expect(codecFailureCode(handle)).toBe(1002);
  } finally {
    destroyCodec(handle);
  }
});

test("a client accepts an unmasked frame a server would refuse", () => {
  const handle = codecAt(CODEC_ROLE.client);
  try {
    const unmasked = Buffer.from([0x81, 0x02, 0x68, 0x69]);
    expect(feedCodec(handle, unmasked)).toEqual({ kind: "consumed", bytes: 4 });
    expect(drain(handle).map((event) => event.kind)).toEqual([CODEC_KINDS[0]]);
    expect(codecFailureCode(handle)).toBe(0);
  } finally {
    destroyCodec(handle);
  }
});

test("an invalid text payload is refused with 1007", () => {
  const handle = codecAt(CODEC_ROLE.server);
  try {
    // 0xc3 announces a two-byte sequence and 0x28 is not a continuation byte.
    const frames = clientFrames([{ opcode: 0x1, payload: Buffer.from([0xc3, 0x28]) }]);
    expect(feedCodec(handle, frames)).toEqual({ kind: "failed" });
    expect(codecFailureCode(handle)).toBe(1007);
  } finally {
    destroyCodec(handle);
  }
});

test("a message over the capacity is refused with 1009", () => {
  const capacity = engineLimits().messageBytes;
  const handle = codecAt(CODEC_ROLE.server);
  try {
    const at = clientFrames([{ opcode: 0x1, payload: Buffer.alloc(capacity) }]);
    expect(feedCodec(handle, at)).toEqual({ kind: "consumed", bytes: at.length });
    expect(drain(handle).map((event) => event.payload.length)).toEqual([capacity]);

    const over = clientFrames([{ opcode: 0x1, payload: Buffer.alloc(capacity + 1) }]);
    expect(feedCodec(handle, over)).toEqual({ kind: "failed" });
    expect(codecFailureCode(handle)).toBe(1009);
  } finally {
    destroyCodec(handle);
  }
});

test("a refusal is reported once and stays reported", () => {
  const handle = codecAt(CODEC_ROLE.server);
  try {
    const unmasked = Buffer.from([0x81, 0x02, 0x68, 0x69]);
    expect(feedCodec(handle, unmasked)).toEqual({ kind: "failed" });
    drain(handle);
    // A connection that has been refused is finished, so a later call reports the
    // same reason rather than a fresh, healthy one.
    expect(feedCodec(handle, Buffer.from("hi"))).toEqual({ kind: "failed" });
    expect(codecFailureCode(handle)).toBe(1002);
  } finally {
    destroyCodec(handle);
  }
});
