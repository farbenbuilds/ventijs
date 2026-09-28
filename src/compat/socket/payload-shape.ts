import type { BinaryTypeValue } from "../../types/socket";

/// The four values `ws` accepts, and what a binary message becomes under each. A
/// *delivery* decision, not a parsing one: the bytes are identical and only the object
/// the listener is handed differs. `fragments` is the interesting one, because `ws`
/// emits the pieces the peer sent without concatenating, so the boundaries are what make
/// the pieces recoverable; they are read between the codec's `select` and `take`.
export type BinaryPayload = Buffer | ArrayBuffer | Blob | Buffer[];

/// `ends` is the codec's ascending fragment boundary list, ignored by every value but
/// `fragments`. A whole message has no interior boundary, so `fragments` yields one
/// element, as `ws` does for a one-frame message.
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

/// `Buffer.buffer` is the whole underlying allocation, up to 64 KiB of whatever else the
/// kernel delivered in the same read, so handing it over would show a caller a megabyte
/// of neighbours through `byteLength`. The copy makes the length the message's own.
function slicedArrayBuffer(payload: Buffer): ArrayBuffer {
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
}

/// Each piece is a `subarray`, not a `slice`, so the reassembled buffer is copied once
/// and the fragments are windows into it. A `slice` per fragment is the copy
/// `binaryType: "fragments"` exists to avoid.
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
