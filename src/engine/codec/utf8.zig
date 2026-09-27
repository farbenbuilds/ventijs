//! Incremental UTF-8 validation for RFC 6455 section 8.1.
//!
//! A text message is validated as it arrives rather than after reassembly,
//! because a peer can put a 64 KiB payload in one frame and a single 4-byte
//! sequence in another, and only a validator that carries its state across chunk
//! boundaries can reject a message whose invalid byte is at the end.
//!
//! The state is a plain value, not a pointer to a heap buffer, so folding a chunk
//! is a copy and a call and needs no allocation on the message path. The
//! validator holds the count of continuation bytes still expected and the legal
//! range of the next one; that pair is enough to reject every sequence RFC 3629
//! forbids, because the range narrows on exactly the two lead bytes where a
//! naive `0x80..0xbf` would admit an overlong form (`0xC0`, `0xC1`), a surrogate
//! (`0xED` followed by `0xA0` or above), or a codepoint past `U+10FFFF` (`0xF4`
//! followed by `0x90` or above).
//!
//! `std.unicode` has no incremental validator, only `utf8ValidateSlice` over a
//! whole slice, so this is the codec's own.

/// Folding state. Copying it is the whole cost of validating a chunk.
pub const State = struct {
    /// Continuation bytes still expected to finish the current sequence.
    remaining: u3 = 0,
    /// Lowest byte the next continuation may take.
    lower: u8 = continuation_lower,
    /// Highest byte the next continuation may take.
    upper: u8 = continuation_upper,
};

const continuation_lower: u8 = 0x80;
const continuation_upper: u8 = 0xbf;

/// Folds one chunk into the validator, or returns null if the chunk contains a
/// byte that cannot continue or begin a valid sequence.
///
/// A null return is terminal for the connection: RFC 6455 requires a 1007 close
/// and forbids delivering the message, and a stream cannot be resynchronized
/// after invalid UTF-8 because the byte lengths of the following sequences are
/// themselves unknown.
pub fn feed(state: State, input: []const u8) ?State {
    var next = state;
    for (input) |byte| {
        if (next.remaining != 0) {
            if (byte < next.lower or byte > next.upper) return null;
            next.remaining -= 1;
            next.lower = continuation_lower;
            next.upper = continuation_upper;
            continue;
        }
        next = lead(byte) orelse return null;
    }
    return next;
}

/// Whether the state sits on a codepoint boundary.
///
/// A message that ends mid-sequence is invalid even when every byte it did
/// contain was in range, which is the case a validator that only ever checks
/// incoming bytes misses: the truncation is only visible at the end.
pub fn complete(state: State) bool {
    return state.remaining == 0;
}

/// Resolves a lead byte into the state that follows it.
fn lead(byte: u8) ?State {
    if (byte <= 0x7f) return .{};
    if (byte < 0xc2) return null; // 0xC0 and 0xC1 are always overlong.
    if (byte <= 0xdf) return .{ .remaining = 1 };
    if (byte == 0xe0) return .{ .remaining = 2, .lower = 0xa0 };
    if (byte <= 0xec) return .{ .remaining = 2 };
    if (byte == 0xed) return .{ .remaining = 2, .upper = 0x9f }; // No surrogates.
    if (byte <= 0xef) return .{ .remaining = 2 };
    if (byte == 0xf0) return .{ .remaining = 3, .lower = 0x90 };
    if (byte <= 0xf3) return .{ .remaining = 3 };
    if (byte == 0xf4) return .{ .remaining = 3, .upper = 0x8f }; // At most U+10FFFF.
    return null; // 0xF5 and above, and any stray continuation byte.
}
