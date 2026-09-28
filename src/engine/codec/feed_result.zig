//! What one `feed` call did with its input, and why it stopped before consuming the rest.

pub const Outcome = enum(u8) {
    ok = 0,
    /// The event queue is full. Drain it and feed the same input again.
    backpressure = 1,
    /// A frame violated the protocol. The codec's `failure_code` names which way.
    failed = 2,
};

/// A named type rather than an inline struct, because the driver and `refuse` both return one.
pub const FeedResult = struct {
    /// Bytes taken from the input; everything from here on has to be fed again by the caller.
    consumed: usize,
    outcome: Outcome,
};
