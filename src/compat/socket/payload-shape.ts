import type { BinaryTypeValue } from "../../types/socket";

/// The four values `ws` accepts, and what a binary message becomes under each.
///
/// The shape is decided in the receiver in `ws` and it is a *delivery* decision, not
/// a parsing one: the bytes are identical and only the object the listener is handed
/// differs. It was missing here entirely, so a caller who set `binaryType =
/// "arraybuffer"` compiled cleanly and received a `Buffer` — the same
/// silently-wrong-on-the-wire failure shape as the `send` options, and worse because
/// nothing on the wire is wrong to look at.
///
/// `fragments` is the interesting one. `ws` emits the pieces the peer sent, without
/// concatenating, which is the whole point of the value: a large binary protocol pays
/// one copy instead of two. The codec already reassembles into a single buffer, so the
/// boundaries are what make the pieces recoverable, and they are read between the
/// codec's `select` and `take` rather than reconstructed here.
export type BinaryPayload = Buffer | ArrayBuffer | Blob | Buffer[];

/// Shapes one reassembled binary payload for the socket's `binaryType`.
///
/// `ends` is the codec's fragment boundary list, ascending, and is ignored by every
/// value but `fragments`. A message that arrived whole has no interior boundary, so
/// `fragments` yields a one-element array and `ws` does the same for a one-frame
/// message.
export function shapeBinary(
  binaryType: BinaryTypeValue,
  payload: Buffer,
  ends: readonly number[] | null,
): BinaryPayload {
  switch (binaryType) {
    case "arraybuffer":
      return slicedArrayBuffer(payload);
    case "blob":
      // Re-wrapped rather than handed over as a `Buffer`: `Blob`'s part type wants a
      // view over a plain `ArrayBuffer`, and a `Buffer` is a view over an
      // `ArrayBufferLike`. The wrapper copies, and the Blob copies again, which is the
      // cost `blob` is for -- it is the value a browser-shaped consumer needs.
      return new Blob([new Uint8Array(payload)]);
    case "fragments":
      return sliceFragments(payload, ends);
    case "nodebuffer":
      return payload;
  }
}

/// An `ArrayBuffer` holding exactly the message and nothing else.
///
/// `Buffer.buffer` is the whole of the underlying allocation, which for a socket read
/// is up to 64 KiB of whatever else the kernel delivered in the same read, so it
/// cannot be handed over: a caller would see a megabyte of neighbours through
/// `byteLength`. The copy is what makes the length the message's own, and the cast is
/// what makes it an `ArrayBuffer` rather than an `ArrayBufferLike` — `Buffer.from`
/// always allocates a plain one, so there is no `SharedArrayBuffer` to exclude.
function slicedArrayBuffer(payload: Buffer): ArrayBuffer {
  return payload.buffer.slice(
    payload.byteOffset,
    payload.byteOffset + payload.byteLength,
  ) as ArrayBuffer;
}

/// The pieces the peer sent, as separate `Buffer`s over one copy of the bytes.
///
/// Each piece is a `subarray`, not a `slice`, so the reassembled buffer is copied
/// once and the fragments are windows into it. The alternative — a `slice` per
/// fragment — is the copy `binaryType: "fragments"` exists to avoid.
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
