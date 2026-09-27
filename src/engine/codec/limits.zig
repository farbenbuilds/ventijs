//! The per-connection limits a codec is built with, and the one place they are checked.
//!
//! Split out of `state.zig` and `handles.zig` because three things had to agree about
//! these numbers and each of them repeated them: the boundary, which had to refuse a
//! value it could not represent; the codec, which had to refuse a value it could not
//! enforce; and the table, which had to hand a validated record to both.
//!
//! **Zero is not a limit, it is the absence of one.** `ws` guards its length check
//! with `_maxPayload > 0` and its fragment count with `_maxFragments > 0`, so a zero
//! disables the check rather than refusing every message. A codec has no such guard to
//! disable -- it enforces whatever number it is given -- so `0` is translated to the
//! ceiling here, at the one place every path goes through. `engineLimits` reports the
//! ceiling as `maxPayloadBytes` and `maxFragments`, so the translation is readable
//! rather than implicit.

const capacities = @import("capacities.zig");

/// Why a limit was refused. Distinct from the protocol refusals in `events.Failure`:
/// a peer that did nothing wrong is the one being told, and 1009 would be the wrong
/// close code because the peer's message was never the problem.
pub const Error = error{ InvalidCapacity, InvalidMessageCap };

/// The validated limits of one connection.
pub const Limits = struct {
    /// The largest message the codec accepts, in either direction.
    max_message: usize,
    /// The most fragments one message may be split into.
    max_fragments: usize,
    /// Whether a text payload is validated as UTF-8 as it arrives.
    validate_utf8: bool,

    /// The largest message a codec can be asked to accept, which is the boundary's own
    /// number width rather than a memory decision: the buffers grow to what a peer
    /// sends, so a large ceiling costs nothing until a peer earns it.
    pub const message_ceiling = capacities.max_message_bytes;

    /// The largest fragment count, from the same number and for the same reason.
    pub const fragment_ceiling = capacities.max_fragments;

    /// Validates untrusted values once, so every later call takes a trusted record and
    /// performs no further bounds work.
    ///
    /// A value above a ceiling is refused rather than clamped. Clamping is the exact
    /// failure this replaced: a `maxPayload` normalized to 100 MiB, reported on
    /// `server.options`, and then a different limit quietly enforced, which a caller
    /// has no way to discover. A zero is the one value translated rather than refused,
    /// and only because `ws` defines it that way.
    pub fn trust(max_message: usize, max_fragments: usize, validate_utf8: bool) Error!Limits {
        const message = or_ceiling(max_message, message_ceiling);
        if (message > message_ceiling) return error.InvalidMessageCap;
        const fragments = or_ceiling(max_fragments, fragment_ceiling);
        if (fragments > fragment_ceiling) return error.InvalidCapacity;
        return .{
            .max_message = message,
            .max_fragments = fragments,
            .validate_utf8 = validate_utf8,
        };
    }
};

/// `0` means "no limit", so it becomes the ceiling a codec can actually enforce.
fn or_ceiling(requested: usize, ceiling: usize) usize {
    if (requested == 0) return ceiling;
    return requested;
}
