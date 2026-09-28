/// The capacities and ceilings the linked addon was built with, read from the Zig
/// `comptime` constants rather than restated here: a duplicated constant is how a
/// compiled limit and its documented value drift apart.

// `messageBytes` is the engine route's startup slab, carved once and charged to every
// live server, which is why no option can move it. `maxPayloadBytes` is the largest
// `maxPayload` a codec may be given, as large as the boundary's number width because a
// codec's buffers are runtime-sized. Reading one and assuming the other is the mistake
// this separation exists to make impossible.
export type NativeEngineLimits = {
  readonly connectionCapacity: number;
  readonly messageBytes: number;
  readonly frameBytes: number;
  readonly inboundSlots: number;
  readonly outboundSlots: number;
  /// The most fragments one message may be split into, measured against `maxFragments`
  /// and closed with 1008. A ceiling, not a reservation, so it costs nothing.
  readonly maxFragments: number;
  /// The largest `maxPayload` a codec may be given, in bytes. Reported so a caller
  /// wanting 4 GiB messages finds out here, not from a `RangeError` later.
  readonly maxPayloadBytes: number;
};
