import type { BinaryTypeValue } from "../../types/socket";

/// The four values `ws` accepts, and what a binary message becomes under each. A *delivery*
/// decision, not a parsing one. `fragments` is the interesting one: `ws` emits the pieces the
/// peer sent without concatenating, so the boundaries are what make them recoverable.
export type BinaryPayload = Buffer | ArrayBuffer | Blob | Buffer[];

/// `ends` is the codec's ascending fragment boundary list, ignored by every value but
/// `fragments`, which yields one element for a whole message, as `ws` does for one frame.
export function shapeBinary(
  binaryType: BinaryTypeValue,
  payload: Buffer,
  ends: readonly number[] | null,
): BinaryPayload {
  switch (binaryType) {
    case "arraybuffer":
      return slicedArrayBuffer(payload);
    case "blob":
      // Re-wrapped rather than handed over as a `Buffer`, whose view is over an
      // `ArrayBufferLike`: the double copy is the cost `blob` is for.
      return new Blob([new Uint8Array(payload)]);
    case "fragments":
      return sliceFragments(payload, ends);
    case "nodebuffer":
      return payload;
  }
}

/// `Buffer.buffer` is the whole underlying allocation, up to 64 KiB of whatever else the kernel
/// delivered in the same read, so the copy is what makes `byteLength` the message's own.
function slicedArrayBuffer(payload: Buffer): ArrayBuffer {
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
}

/// Each piece is a `subarray`, not a `slice`, so the reassembled buffer is copied once.
function sliceFragments(payload: Buffer, ends: readonly number[] | null): Buffer[] {
  if (ends === null || ends.length === 0) return [payload];
  const pieces: Buffer[] = [];
  let start = 0;
  for (const end of ends) {
    const at = Math.min(end, payload.length);
    if (at > start) pieces.push(payload.subarray(start, at));
    start = at;
  }
  if (start < payload.length) pieces.push(payload.subarray(start));
  return pieces.length > 0 ? pieces : [payload];
}
