/// The capacities the linked addon was built with, read from the Zig `comptime` constants.

/// `messageBytes` is the engine route's startup slab, carved once and charged to every live
/// server, which is why no option can move it; `maxPayloadBytes` only bounds `maxPayload`.
export type NativeEngineLimits = {
  readonly connectionCapacity: number;
  readonly messageBytes: number;
  readonly frameBytes: number;
  readonly inboundSlots: number;
  readonly outboundSlots: number;
  /// The most fragments one message may be split into, closed with 1008; a ceiling, not a
  /// reservation, so it costs nothing at rest.
  readonly maxFragments: number;
  /// The largest `maxPayload` a codec may be given, in bytes, so 4 GiB is found out here.
  readonly maxPayloadBytes: number;
};
