import { expect } from "vitest";
import { selectCodecEvent, selectedCodecEvent, takeCodecEvent } from "../../src/binding/codec";
import type { CodecEvent } from "../../src/binding/codec";

/// A masked frame's header: two fixed bytes and the four-byte mask key. Tests that
/// assert where a decode stopped name it rather than writing `6`.
export const MASKED_HEADER_BYTES = 6;

/// A frame a `ws` client would put on the wire: masked, as a client must.
///
/// The tests build client frames here rather than through the codec's own encoder
/// wherever the point is to check the *decoder*, because a decoder tested with its
/// matching encoder agrees with a symmetrically wrong pair. The mask is a fixed key
/// so a failure is reproducible; nothing here depends on it being unpredictable,
/// which is a property of the encoder and is pinned there instead.
export type ClientFrame = {
  readonly opcode: number;
  readonly payload: Buffer;
};

const MASK: readonly number[] = [0x37, 0xfa, 0x21, 0x3d];

/// Encodes one client frame.
export function clientFrame(frame: ClientFrame): Buffer {
  const length = frame.payload.length;
  const extended = length > 125;
  const header = Buffer.alloc(2 + (extended ? 2 : 0) + 4);
  header[0] = 0x80 | frame.opcode;
  if (extended) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 0x80 | length;
  }
  header.set(MASK, 2 + (extended ? 2 : 0));
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

/// Every queued event, drained.
///
/// A loop rather than a single read because the queue is a control ring plus one
/// message slot: a caller that assumes a fixed number of events per feed either
/// leaves events behind or reads a slot that is not there yet.
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
