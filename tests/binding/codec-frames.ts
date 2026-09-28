import { expect } from "vitest";
import { selectCodecEvent, selectedCodecEvent, takeCodecEvent } from "../../src/binding/codec";
import type { CodecEvent } from "../../src/binding/codec";

/// Two fixed header bytes plus the four-byte mask key, named so a decode-stop assertion says 6.
export const MASKED_HEADER_BYTES = 6;

/// A decoder tested with its own encoder agrees with a symmetrically wrong pair, so client frames
/// are built here. The mask is a fixed key for reproducibility; unpredictability is the encoder's property.
export type ClientFrame = {
  readonly opcode: number;
  readonly payload: Buffer;
  /// A message split across frames has to say so: the continuation opcode is mandatory, not optional.
  readonly fin?: boolean;
};

const MASK: readonly number[] = [0x37, 0xfa, 0x21, 0x3d];

/// The seven-bit length field has three encodings, and the one above 65535 needs an eight-byte
/// length. A helper that knew only two made the 126 and 127 cases untestable once the compiled cap
/// moved from 32 KiB to 64 KiB -- the case above the cap is the one needing the missing form.
export function clientFrame(frame: ClientFrame): Buffer {
  const length = frame.payload.length;
  const wide = length > 0xffff;
  const extended = length > 125;
  const extra = wide ? 8 : extended ? 2 : 0;
  const header = Buffer.alloc(2 + extra + 4);
  header[0] = (frame.fin === false ? 0x00 : 0x80) | frame.opcode;
  if (wide) {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  } else if (extended) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 0x80 | length;
  }
  header.set(MASK, 2 + extra);
  const body = Buffer.from(frame.payload);
  for (let index = 0; index < body.length; index += 1) {
    body[index] = (body[index] as number) ^ (MASK[index & 3] as number);
  }
  return Buffer.concat([header, body]);
}

export function clientFrames(frames: readonly ClientFrame[]): Buffer {
  return Buffer.concat(frames.map(clientFrame));
}

/// A close frame payload: two big-endian code bytes and a UTF-8 reason.
export function closePayload(code: number, reason: string): Buffer {
  const body = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + body.length);
  payload.writeUInt16BE(code, 0);
  body.copy(payload, 2);
  return payload;
}

/// A loop, not a single read: the queue is a control ring plus one message slot, so a fixed event
/// count per feed either leaves events behind or reads a slot that is not there yet.
export function drain(handle: bigint): CodecEvent[] {
  const events: CodecEvent[] = [];
  while (selectCodecEvent(handle)) {
    const event = selectedCodecEvent(handle);
    expect(event).not.toBeNull();
    if (event === null) break;
    events.push(event);
    takeCodecEvent(handle);
  }
  return events;
}
