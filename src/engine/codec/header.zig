//! Frame header layout: the length field, the opcode, the masking key, and the faults a base
//! header can name on its own. The receive rule exists because `zslay` reports "reserved bit
//! set", "control frame not final" and "control frame too long" as one `ProtocolError`.

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
const opcode_control_max: u8 = 0x0a;

/// The seven-bit length field's encoding: 0-125 inline, 126 for two bytes, 127 for eight.
pub fn length_field(len: usize) u7 {
    if (len > std.math.maxInt(u16)) return 127;
    if (len >= 126) return 126;
    return @intCast(len);
}

/// 2^53 - 1, the largest integer a JavaScript number represents exactly. `ws` refuses a
/// frame above it as an unsupported length, because no caller could have asked for it.
pub const max_safe_frame_len: u64 = 0x001f_ffff_ffff_ffff;

/// The two base octets' faults, or null. RSV1 is not here: `rsv1.zig` owns that bit.
///
/// The opcode range is 0x0 to 0xF, and only 0x8 to 0xA are control frames. `ws`
/// reports 0xB to 0xF as `WS_ERR_INVALID_OPCODE` whatever else is wrong with the frame,
/// so the reserved range is checked before the control-frame rules rather than after.
pub fn base_failure(base: [2]u8, fragment_open: bool) ?Failure {
    if (base[0] & rsv_2_3_mask != 0) return .unexpected_rsv_2_3;
    const opcode = base[0] & opcode_mask;
    if (opcode > opcode_control_max) return .invalid_opcode;
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

/// The length a fully-read header declares, read from the codec's own copy because the parser
/// refuses a frame over its ceiling while accepting the header, making the two one error.
pub fn declared_length(buf: []const u8) ?u64 {
    if (buf.len < 2) return null;
    return switch (buf[1] & 0x7f) {
        126 => if (buf.len < 4) null else std.mem.readInt(u16, buf[2..4][0..2], .big),
        127 => if (buf.len < 10) null else std.mem.readInt(u64, buf[2..10][0..8], .big),
        inline else => |short| @as(u64, short),
    };
}

/// The wire opcode for a kind, or null when the kind has no frame.
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

/// RFC 6455 section 5.3 requires a fresh, unpredictable key per frame, because the mask
/// exists to stop a malicious script on the peer from poisoning a proxy's cache with bytes
/// of its own choosing; a predictable key is no mask, so this reads `randomSecure` and
/// reports a failure rather than falling back to a weak source. The `Threaded` is built per
/// call because a generator seeded once would make every mask predictable from the first.
pub fn draw_masking_key(key: *zslay.MaskingKey) !void {
    var source: std.Io.Threaded = std.Io.Threaded.init_single_threaded;
    source.io().randomSecure(key) catch return error.RandomSourceUnavailable;
}
