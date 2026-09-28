//! The vocabulary the transmit path answers in, split out of `encode.zig` so the FFI
//! and the handle table can name a frame refusal without importing a frame-layout module.

const events = @import("events.zig");

/// Why transmit state could not be built; distinct from `Encoded.failed`, which needs a
/// connection to refuse anything on.
pub const Error = error{OutOfMemory};

/// The result of formatting one frame: its length, or why it could not be formatted.
pub const Encoded = union(enum) {
    /// The framed byte count, which is what the caller needs to allocate its buffer.
    ok: usize,
    failed: events.Failure,
};
