//! Incremental UTF-8 validation for RFC 6455 section 8.1, folded as a message arrives because
//! a peer can split a 4-byte sequence across two frames. The carried range is what rejects
//! overlongs, surrogates, and codepoints past `U+10FFFF`.

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

/// Folds one chunk into the validator, or returns null if it contains a byte that cannot
/// continue or begin a valid sequence. A null is terminal: RFC 6455 requires a 1007 close and
/// forbids delivery, and a stream cannot be resynchronized after invalid UTF-8.
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

/// Whether the state sits on a codepoint boundary. A message ending mid-sequence is invalid
/// even when every byte was in range, which a byte-wise validator cannot see.
pub fn complete(state: State) bool {
    return state.remaining == 0;
}

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
