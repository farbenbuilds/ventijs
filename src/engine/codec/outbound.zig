//! The vocabulary the transmit path answers in.
//!
//! Split out of `encode.zig` because these two types are what every *caller* of the
//! formatter switches on, and they are not what the formatter does. `handles-table.zig`
//! and the FFI both name them, and neither of them should have to import a module whose
//! body is frame layout to find out what a frame refusal is called.

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
