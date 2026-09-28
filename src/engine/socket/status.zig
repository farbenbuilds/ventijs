//! Connection lifecycle vocabulary shared by the socket slab and its FFI. Operation names
//! cross the ABI as camelCase strings onto `EngineStatus`; close-code acceptance mirrors
//! `isValidStatusCode`.

pub const State = enum(u8) { open, closing, closed };

pub const Status = enum(u8) {
    ok,
    closing,
    closed,
    backpressure,
    invalid_handle,
    payload_too_large,
    invalid_close_code,
    invalid_close_reason,
    protocol_error,
    policy_violation,
};

/// RFC 6455 caps a close frame payload at 125 bytes, two of which are the code.
pub const max_close_reason_bytes: usize = 123;

/// Close codes `ws` accepts: the application range plus 1000-1014 minus the reserved codes.
pub fn valid_close_code(code: u16) bool {
    if (code >= 3000 and code <= 4999) return true;
    if (code < 1000 or code > 1014) return false;
    return code != 1004 and code != 1005 and code != 1006;
}
