//! The vocabulary the transmit path answers in, split out of `encode.zig` so the FFI
//! and the handle table can name a frame refusal without importing a frame-layout module.

const events = @import("events.zig");

/// Why transmit state could not be built. Distinct from `Encoded.failed`: a codec that
/// could not be built never had a connection to refuse anything on.
pub const Error = error{OutOfMemory};

/// The result of formatting one frame: its length, or why it could not be formatted.
pub const Encoded = union(enum) {
    /// The framed byte count, which is what the caller needs in order to allocate the
    /// buffer it copies into.
    ok: usize,
    failed: events.Failure,
};
