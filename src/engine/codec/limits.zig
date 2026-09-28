//! The per-connection limits a codec is built with. **Zero is not a limit, it is the absence
//! of one**: `ws` guards with `_maxPayload > 0` so a zero disables the check, while a codec
//! enforces whatever number it is given, so 0 becomes the ceiling here.

const capacities = @import("capacities.zig");

/// Distinct from `events.Failure`: a peer that did nothing wrong is the one being told.
pub const Error = error{ InvalidCapacity, InvalidMessageCap };

pub const Limits = struct {
    max_message: usize,
    max_fragments: usize,
    validate_utf8: bool,
    /// Whether RFC 7692 `permessage-deflate` was negotiated: RFC 6455 section 5.2 calls an unset
    /// one malformed, and only an answered handshake may set RSV1.
    permessage_deflate: bool,

    /// The largest message a codec can accept: the boundary's number width, since a large
    /// ceiling costs nothing when the buffers grow to what a peer sends.
    pub const message_ceiling = capacities.max_message_bytes;

    pub const fragment_ceiling = capacities.max_fragments;

    /// Validates untrusted values once, so every later call takes a trusted record. A value
    /// above a ceiling is refused rather than clamped, which no caller can discover.
    pub fn trust(
        max_message: usize,
        max_fragments: usize,
        validate_utf8: bool,
        permessage_deflate: bool,
    ) Error!Limits {
        const message = or_ceiling(max_message, message_ceiling);
        if (message > message_ceiling) return error.InvalidMessageCap;
        const fragments = or_ceiling(max_fragments, fragment_ceiling);
        if (fragments > fragment_ceiling) return error.InvalidCapacity;
        return .{
            .max_message = message,
            .max_fragments = fragments,
            .validate_utf8 = validate_utf8,
            .permessage_deflate = permessage_deflate,
        };
    }
};

fn or_ceiling(requested: usize, ceiling: usize) usize {
    if (requested == 0) return ceiling;
    return requested;
}
