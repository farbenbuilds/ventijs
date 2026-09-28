//! RSV1: the one reserved bit a negotiated extension may use. `zslay` refuses a header with
//! *any* reserved bit set -- right for a connection that negotiated nothing, wrong for one that
//! negotiated `permessage-deflate`. So the bit is latched and cleared in the codec's own header copy.

const events = @import("events.zig");

/// RSV1 in a base header octet: FIN is bit 7, RSV1 is bit 6, RSV2 is bit 5, RSV3 is bit 4.
pub const mask: u8 = 0x40;

/// `data` on a data frame and `ignored` on a continuation -- `ws` reads RSV1 only on the first
/// frame of a message -- and `refused` elsewhere: RFC 6455 sections 5.2 and 5.5.
pub fn meaning(opcode: u4, negotiated: bool) Meaning {
    return switch (opcode) {
        0x1, 0x2 => if (negotiated) .data else .refused,
        0x0 => .ignored,
        0x8...0xa => .refused,
        else => .refused,
    };
}

pub const Meaning = enum { data, ignored, refused };

/// `first` is a pointer because the bit is cleared through it: `zslay` parses this octet on
/// the next `advance_rx` and refuses a reserved bit.
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

/// Narrower than the inbound rule because RSV1 has to mean the same thing both ways. A control
/// frame may never set it (section 5.5), nor may a fragment: a compressed fragmented message
/// needs a deflate context a one-shot codec does not keep.
pub fn may_compress(asked: bool, control: bool, fin: bool) bool {
    if (!asked) return false;
    if (control) return false;
    return fin;
}

/// After `zslay.frame.encode_header`, which refuses a reserved bit -- the same reason `inspect`
/// clears one. The octet is first and the payload unmasked, so a mask is untouched.
pub fn mark(frame: []u8) void {
    if (frame.len == 0) return;
    frame[0] |= mask;
}
