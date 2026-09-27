//! What one `feed` call did with its input.
//!
//! Its own module because it is the boundary between the driver and the caller:
//! the driver returns it, the codec re-exports it, and neither should have to
//! import the other to name it.

/// Why `feed` stopped before consuming its input.
pub const Outcome = enum(u8) {
    /// Every byte was consumed.
    ok = 0,
    /// The event queue is full. Drain it and feed the same input again.
    backpressure = 1,
    /// A frame violated the protocol. The codec's `failure_code` names which way.
    failed = 2,
};

/// A named type rather than an inline struct, because the driver and `refuse` both
/// return one and two spellings of the same shape are two types in Zig.
pub const FeedResult = struct {
    /// Bytes taken from the input. Everything from here on has to be fed again,
    /// and the caller still holds those bytes in the buffer it already owns.
    consumed: usize,
    outcome: Outcome,
};
