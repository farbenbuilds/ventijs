/// The capacities and ceilings the linked addon was built with, read from the Zig
/// `comptime` constants rather than restated here.
///
/// They are all promises the compatibility layer has to keep, and a duplicated
/// constant is how a compiled limit and its documented value drift apart: the message
/// cap was raised from 32 KiB to 64 KiB once already while a test that asserted the
/// boundary kept asserting the old number and passed by asserting something the engine
/// no longer did.
///
/// **The message cap and the `maxPayload` ceiling are different numbers.** `messageBytes`
/// is the engine route's startup slab, carved once and charged to every live server,
/// which is why it is a compile-time constant no option can move. `maxPayloadBytes` is
/// the largest `maxPayload` a codec may be given, and it is as large as the boundary's
/// number width because a codec's buffers are runtime-sized and grow to what a peer
/// actually sends. Reading one and assuming the other is the mistake this separation
/// exists to make impossible.
export type NativeEngineLimits = {
  readonly connectionCapacity: number;
  readonly messageBytes: number;
  readonly frameBytes: number;
  readonly inboundSlots: number;
  readonly outboundSlots: number;
  /// The most fragments one message may be split into, which is what a
  /// `maxFragments` option is measured against and what a peer exceeding it is
  /// closed with 1008 for. A ceiling rather than a reservation: the boundary list
  /// grows on demand, so this number costs nothing until a peer fragments that much.
  readonly maxFragments: number;
  /// The largest `maxPayload` a codec may be given, in bytes.
  ///
  /// Reported rather than documented so that a caller who wants 4 GiB messages finds
  /// out here instead of from a `RangeError` at the first connection, and so that an
  /// option above it is refused by name with the option's own name in the message.
  readonly maxPayloadBytes: number;
};
