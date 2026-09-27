//! Two properties of the boundary a caller depends on, neither of which held:
//! a `Buffer` handed to the decoder comes back unchanged, and a record the engine
//! cannot carry does not stop the ones behind it.

import { expect, test } from "vitest";
import {
  CODEC_KINDS,
  destroyCodec,
  feedCodec,
  selectCodecEvent,
  selectedCodecEvent,
  takeCodecEvent,
} from "../../src/binding/codec";
import { clientFrames } from "./codec-frames";
import { serverCodec } from "./codec-support";

test("the caller's buffer is not modified", () => {
  const handle = serverCodec();
  try {
    // A masked frame is unmasked *somewhere*. If that somewhere is the caller's
    // memory, every byte of a masked payload comes back as plaintext, and a caller
    // that kept the Buffer -- to log it, to compare it, to feed a second decoder --
    // reads the decrypted message instead of what the peer sent.
    const masked = clientFrames([{ opcode: 0x1, payload: Buffer.from("secret") }]);
    const before = Buffer.from(masked);
    expect(feedCodec(handle, masked)).toEqual({ kind: "consumed", bytes: masked.length });
    expect(masked.equals(before)).toBe(true);
  } finally {
    destroyCodec(handle);
  }
});

test("the same bytes can be fed to two codecs", () => {
  // The observable consequence of the property above, and why it is worth a test of
  // its own: comparing two decoders needs both to see the same input, and an
  // in-place contract means the second one sees the first's plaintext.
  const frames = clientFrames([
    { opcode: 0x9, payload: Buffer.from("beat") },
    { opcode: 0x1, payload: Buffer.from("hello") },
  ]);
  const first = serverCodec();
  const second = serverCodec();
  try {
    expect(feedCodec(first, frames).kind).toBe("consumed");
    expect(feedCodec(second, frames).kind).toBe("consumed");
  } finally {
    destroyCodec(first);
    destroyCodec(second);
  }
});

test("a masked frame still decodes to its plaintext", () => {
  // The other half of the same change: the copy has to be a copy, not a skip. A
  // decoder that stopped unmasking to avoid touching the caller's memory would pass
  // the two tests above and deliver the mask.
  const handle = serverCodec();
  try {
    const frames = clientFrames([{ opcode: 0x1, payload: Buffer.from("secret") }]);
    expect(feedCodec(handle, frames).kind).toBe("consumed");
    expect(selectCodecEvent(handle)).toBe(true);
    const event = selectedCodecEvent(handle);
    takeCodecEvent(handle);
    expect(event?.kind).toBe(CODEC_KINDS[0]);
    expect(event?.payload.toString()).toBe("secret");
  } finally {
    destroyCodec(handle);
  }
});
