//! RSV1: the one reserved bit a negotiated extension is allowed to use.
//!
//! Split into its own module because it is the only place the codec touches a reserved
//! bit, and because what happens to it is a two-sided decision that has to be stated
//! once: `zslay` refuses a header with *any* reserved bit set, which is right for a
//! connection that negotiated nothing and wrong for one that negotiated
//! `permessage-deflate`. So the bit is read here, latched, and cleared before `zslay`
//! parses the header -- the codec then sees a conforming header and the extension's
//! meaning lives in the codec's own state.
//!
//! **`zslay` is not bypassed, it is told the truth.** The bit is cleared in the codec's
//! own copy of the header, which `ingest` already makes a copy of, so a caller's buffer
//! is untouched and the header `zslay` parses is the header RFC 6455 describes once
//! RSV1 has been accounted for. The alternative -- a parallel header parser -- would be
//! two implementations of the same wire format that have to agree by inspection, which
//! is the thing this codec was built to avoid.

const events = @import("events.zig");

/// RSV1 in a base header octet: FIN is bit 7, RSV1 is bit 6, RSV2 is bit 5, RSV3 is bit 4.
pub const mask: u8 = 0x40;

/// What a base header octet's RSV1 bit means, given the opcode it carries.
///
/// The four answers, and the two that are refusals:
///
/// - `data`, on `text` or `binary`: the message is compressed. This is the whole point
///   of the bit, and it is the only opcode on which it carries meaning -- `ws` reads it
///   on exactly these two and ignores it everywhere else, which is what RFC 7692's
///   "the first frame of a message" means on the wire.
/// - `ignored`, on a continuation: `ws` reads RSV1 only on the first frame, so a
///   continuation's bit is not looked at. It is still cleared, so `zslay` accepts the
///   header.
/// - `refused`, on a control frame: RFC 6455 section 5.5 requires a control frame to
///   have no reserved bits at all.
/// - `refused`, on anything else, and whenever the bit is set on a data frame with no
///   extension negotiated: RFC 6455 section 5.2 says RSV1 must be zero unless an
///   extension defines a meaning for it.
pub fn meaning(opcode: u4, negotiated: bool) Meaning {
    return switch (opcode) {
        0x1, 0x2 => if (negotiated) .data else .refused,
        0x0 => .ignored,
        0x8...0xa => .refused,
        else => .refused,
    };
}

pub const Meaning = enum { data, ignored, refused };

/// Latches a compressed message off a base header octet and clears the bit.
///
/// `first` is a pointer because the bit is cleared through it: `zslay` parses this same
/// octet on the next `advance_rx` and refuses a header with a reserved bit set, so a
/// bit that means something to this module is a bit that must not be there by then. The
/// clear happens on every path that is not a refusal, because a refused frame is closed
/// and never parsed.
pub fn inspect(compressed: *bool, first: *u8, negotiated: bool) ?events.Failure {
    if (first.* & mask == 0) return null;
    switch (meaning(@truncate(first.* & 0x0f), negotiated)) {
        .data => compressed.* = true,
        .ignored => {},
        .refused => return .unexpected_rsv_1,
    }
    first.* &= ~mask;
    return null;
}

/// Whether a frame may carry a compressed payload and RSV1 with it.
///
/// The outbound half of the rule above, and it is narrower than the inbound one because
/// RSV1 has to mean the *same* thing in both directions. A control frame never may:
/// RFC 6455 section 5.5 gives it no reserved bits. A fragment never may: RSV1 marks the
/// first frame of a message, and a compressed fragmented message needs a deflate context
/// carried between frames that a one-shot codec does not keep. A fragment is therefore
/// sent raw rather than sent wrong.
pub fn may_compress(asked: bool, control: bool, fin: bool) bool {
    if (!asked) return false;
    if (control) return false;
    return fin;
}

/// Sets RSV1 on a formatted frame, for a payload that was compressed.
///
/// After `zslay.frame.encode_header` rather than through its `FrameHeader`, because
/// `encode_header` refuses a header with a reserved bit set -- the same reason `inspect`
/// clears one on the way in. The octet is the first of the frame and the payload is not
/// masked yet at that point, so this cannot disturb a client's masking.
pub fn mark(frame: []u8) void {
    if (frame.len == 0) return;
    frame[0] |= mask;
}
