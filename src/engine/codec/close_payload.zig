//! How a close payload splits into the code and reason an event carries.

const std = @import("std");

/// An empty close payload is valid and means "no status", which `ws` reports as 1005.
pub fn close_code(payload: []const u8) u16 {
    if (payload.len < 2) return 0;
    return std.mem.readInt(u16, payload[0..2][0..2], .big);
}

/// A close with no code has no reason either, so an empty payload yields an empty slice.
pub fn close_reason(payload: []const u8) []const u8 {
    if (payload.len < 2) return payload[0..0];
    return payload[2..];
}

/// Whether a close payload carries a code RFC 6455 section 7.4.1 permits; a one-byte payload answers false.
pub fn has_valid_code(payload: []const u8) bool {
    if (payload.len == 0) return true;
    if (payload.len < 2) return false;
    const code = std.mem.readInt(u16, payload[0..2][0..2], .big);
    return is_valid_close_code(code);
}

/// `zslay`'s copy of the permitted codes is private and answers only "valid" or "protocol
/// error", so RFC 6455 section 7.4.1 and the IANA registry are spelled out here.
pub fn is_valid_close_code(code: u16) bool {
    return (code >= 1000 and code <= 1003) or
        (code >= 1007 and code <= 1014) or
        (code >= 3000 and code <= 4999);
}
