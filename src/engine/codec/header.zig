//! Frame header layout: the length field, the opcode, the masking key, and the faults a
//! base header can name on its own.
//!
//! Three small pure functions for the transmit path and one for the receive path, split
//! out so each rule is stated once. The receive rule exists because `zslay` reports
//! "reserved bit set", "control frame not final" and "control frame too long" as one
//! `ProtocolError`, and an application that cannot tell those apart cannot tell a
//! misbehaving proxy from a bug of its own.

const std = @import("std");
const zslay = @import("zslay");
const events = @import("events.zig");

const Kind = events.Kind;
const Failure = events.Failure;

/// Base header octet: FIN is bit 7, RSV2 is bit 5, RSV3 is bit 4, the opcode is 0-3.
const fin_mask: u8 = 0x80;
const rsv_2_3_mask: u8 = 0x30;
const opcode_mask: u8 = 0x0f;
const opcode_control: u8 = 0x08;

/// The seven-bit length field's encoding: 0-125 inline, 126 for a two-byte
/// length, 127 for an eight-byte one.
pub fn length_field(len: usize) u7 {
    if (len > std.math.maxInt(u16)) return 127;
    if (len >= 126) return 126;
    return @intCast(len);
}

/// 2^53 - 1, the largest integer a JavaScript number represents exactly. `ws` refuses a
/// frame above it as an unsupported length rather than as a message over `maxPayload`,
/// because no caller could have asked for a payload of that size.
pub const max_safe_frame_len: u64 = 0x001f_ffff_ffff_ffff;

/// What the two base octets of a frame header say is wrong with it, or null.
///
/// Decided once per frame, and only once both octets are in. RSV1 is not here:
/// `rsv1.zig` owns that bit, because whether it may mean anything depends on the
/// negotiation rather than on the header.
pub fn base_failure(base: [2]u8, fragment_open: bool) ?Failure {
    if (base[0] & rsv_2_3_mask != 0) return .unexpected_rsv_2_3;
    const opcode = base[0] & opcode_mask;
    if (opcode >= opcode_control) {
        if (base[0] & fin_mask == 0) return .expected_fin;
        if (base[1] & 0x7f > 125) return .invalid_control_payload_length;
        return null;
    }
    // A continuation with nothing to continue, or a fresh message inside an open one.
    return switch (opcode) {
        0x0 => if (!fragment_open) .invalid_opcode else null,
        0x1, 0x2 => if (fragment_open) .invalid_opcode else null,
        else => null,
    };
}

/// The payload length a fully-read header declares, read from the codec's own copy.
///
/// Taken here because the parser refuses a frame over its ceiling while accepting the
/// header, so a length that is merely unspeakable and a length that is over the ceiling
/// are the same error unless the number is read first.
pub fn declared_length(buf: []const u8) ?u64 {
    if (buf.len < 2) return null;
    return switch (buf[1] & 0x7f) {
        126 => if (buf.len < 4) null else std.mem.readInt(u16, buf[2..4][0..2], .big),
        127 => if (buf.len < 10) null else std.mem.readInt(u64, buf[2..10][0..8], .big),
        inline else => |short| @as(u64, short),
    };
}

/// The wire opcode for an event kind, or null when the kind is not something a
/// caller may send. `rejected` is the one that has no frame: it reports a frame
/// the codec refused, so it has no frame to send.
pub fn wire_opcode(kind: Kind) ?zslay.Opcode {
    return switch (kind) {
        .text => .text,
        .binary => .binary,
        .continuation => .continuation,
        .ping => .ping,
        .pong => .pong,
        .close => .close,
        .rejected => null,
    };
}

/// Draws a masking key from the operating system.
///
/// RFC 6455 section 5.3 requires a fresh, unpredictable key per frame from a client,
/// because the mask exists to stop a malicious script on the peer from poisoning a
/// proxy's cache with bytes of its own choosing. A predictable key is not a slow mask,
/// it is no mask, so this reads `randomSecure` and reports a failure rather than
/// papering over it with a weak source.
///
/// The `Threaded` is built per call rather than held in a module-level variable, and
/// that is safe: `init_single_threaded` installs no signal handler, opens no descriptor
/// and takes no allocator, so constructing one touches only the operating system. A
/// generator seeded once and carried between frames would make every mask on the
/// connection predictable from the first one.
pub fn draw_masking_key(key: *zslay.MaskingKey) !void {
    var source: std.Io.Threaded = std.Io.Threaded.init_single_threaded;
    source.io().randomSecure(key) catch return error.RandomSourceUnavailable;
}
