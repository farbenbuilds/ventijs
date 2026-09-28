//! How a close payload splits into the code and reason an event carries.
//!
//! Kept beside the event vocabulary rather than inside the receive state machine
//! because the split is a property of the event, not of the parser: the parser
//! knows the payload is 2 bytes of big-endian code followed by UTF-8, and the
//! event is what a caller reports to JavaScript as `close(code, reason)`.
//!
//! The reason for splitting only a close payload is the whole point of these two
//! functions. A ping and a pong carry their bytes whole, and trimming two off the
//! front of either would deliver a short payload for every control frame longer
//! than two bytes.

const std = @import("std");

/// The close code a close payload carries, or 0 when it carries none.
///
/// An empty close payload is valid and means "no status", so this is a length
/// check rather than a decode: the codec reports 0 so the caller can apply its
/// own policy rather than being handed a number the peer never sent. `ws` reports
/// 1005 for a close that arrived with no code.
pub fn close_code(payload: []const u8) u16 {
    if (payload.len < 2) return 0;
    return std.mem.readInt(u16, payload[0..2][0..2], .big);
}

/// The reason a close payload carries, which is everything after the two code
/// bytes. A close with no code has no reason either, so an empty payload yields
/// an empty slice rather than a two-byte one the caller would have to know to
/// trim.
pub fn close_reason(payload: []const u8) []const u8 {
    if (payload.len < 2) return payload[0..0];
    return payload[2..];
}

/// Whether a close payload carries a code RFC 6455 section 7.4 permits.
///
/// An absent code is permitted, and so is a one-byte payload in the sense that this
/// predicate has an opinion about: it returns false, because a payload that carries no
/// complete code is a fault the parser reports separately.
pub fn has_valid_code(payload: []const u8) bool {
    if (payload.len == 0) return true;
    if (payload.len < 2) return false;
    const code = std.mem.readInt(u16, payload[0..2][0..2], .big);
    return is_valid_close_code(code);
}

/// The codes RFC 6455 section 7.4.1 and the IANA registry permit on the wire.
///
/// Spelled out here rather than taken from `zslay`, whose copy is private and answers
/// only "valid" or "protocol error", so a caller cannot tell an illegal code from a
/// control frame of the wrong length.
pub fn is_valid_close_code(code: u16) bool {
    return (code >= 1000 and code <= 1003) or
        (code >= 1007 and code <= 1014) or
        (code >= 3000 and code <= 4999);
}
