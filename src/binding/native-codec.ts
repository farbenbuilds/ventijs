// The codec half of the addon ABI, split from `native.ts` so the engine surface and the
// per-message surface each stay inside the module budget.

/// One decoded frame as `[kindOrdinal, closeCode, payload]`; the payload is already a Node-owned `Buffer`.
export type NativeCodecEvent = [number, number, Buffer];

/// The next retired event as `[kindCode, payload, ends?]`, packed like `NativeCodecInto`.
export type NativeCodecNext = [number, Buffer, (number[] | null)?];

/// A fused feed result: `[kindCode, length, ends?]`. The payload was copied into the
/// caller's buffer, so only the length is needed.
export type NativeCodecInto = [number, number, (number[] | null)?];

export type NativeCodecAddon = {
  /// A ceiling above `engineLimits()`' is refused rather than clamped.
  codecCreate(
    role: number,
    validateUtf8: number,
    maxPayload: number,
    maxFragments: number,
    permessageDeflate: number,
  ): bigint;
  codecDestroy(handle: bigint): void;
  /// Returns bytes consumed, or a negative `codec.ts` outcome ordinal.
  codecFeed(handle: bigint, bytes: Uint8Array): number;
  /// Where the last `codecFeed` stopped, or a negative outcome ordinal.
  codecResume(handle: bigint): number;
  codecPending(handle: bigint): number;
  codecSelect(handle: bigint): boolean;
  codecEvent(handle: bigint): NativeCodecEvent | null;
  /// The fragment boundaries of the selected data message, or null when it arrived whole.
  codecFragments(handle: bigint): number[] | null;
  /// Selects, copies, and retires the next event in one crossing, or null when none waits.
  codecNext(handle: bigint, wantEnds: number): NativeCodecNext | null;
  /// Folds bytes and copies the first event into `out`: null with no event, the positive
  /// needed size when `out` was too small, a tuple on success, or a negative refusal.
  codecProcessInto(
    handle: bigint,
    bytes: Uint8Array,
    wantEnds: number,
    out: Uint8Array,
  ): number | NativeCodecInto | null;
  /// Copies the selected event into `out` after `codecProcessInto` reported it too small.
  codecMaterialize(
    handle: bigint,
    wantEnds: number,
    out: Uint8Array,
  ): number | NativeCodecInto | null;
  codecTake(handle: bigint): void;
  /// Returns the framed length, or a negative encode-failure ordinal. `mask` is
  /// `generateMask`, or empty to draw one here.
  codecEncode(
    handle: bigint,
    kind: number,
    fin: number,
    payload: Uint8Array,
    compress: number,
    maskFrame: number,
    mask: Uint8Array,
  ): number;
  /// Formats one frame into a Node-owned buffer, or returns a negative encode-failure ordinal.
  codecWrite(
    handle: bigint,
    kind: number,
    fin: number,
    payload: Uint8Array,
    compress: number,
    maskFrame: number,
    mask: Uint8Array,
  ): Buffer | number;
  /// Formats only the header for a payload the caller writes as its own chunk. Returns the
  /// header length, or a negative encode-failure ordinal; compression is not offered.
  codecHeader(
    handle: bigint,
    kind: number,
    fin: number,
    payloadLength: number,
    maskFrame: number,
    mask: Uint8Array,
    out: Uint8Array,
  ): number;
  codecOutbound(handle: bigint): Buffer;
  codecOutboundMasked(handle: bigint): boolean;
  codecFailureCode(handle: bigint): number;
  codecFailure(handle: bigint): number;
  codecReset(handle: bigint): void;
  codecRole(handle: bigint): number;
  /// The per-connection ceilings, or null once the handle is stale.
  codecCeilings(handle: bigint): [number, number] | null;
};
