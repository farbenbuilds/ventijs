//! Header-only framing for the writev shape: the caller writes the header and the payload
//! as two chunks, as `ws` does, so no frame-sized buffer is allocated or copied per
//! message. The fused `encode.zig` owns the compressed path, where the wire length is not
//! known until the compressor runs.

const zslay = @import("zslay");
const events = @import("events.zig");
const header = @import("header.zig");
const outbound = @import("outbound.zig");

const Kind = events.Kind;

/// RFC 6455 section 5.5.
const control_capacity: usize = 125;

pub fn format_header(
    role: zslay.EndpointRole,
    max_message_bytes: usize,
    kind: Kind,
    fin: bool,
    payload_len: usize,
    mask: []const u8,
    mask_frame: bool,
    out: []u8,
) outbound.Encoded {
    const opcode = header.wire_opcode(kind) orelse return .{ .failed = .invalid_opcode };
    if (payload_len > max_message_bytes) return .{ .failed = .unsupported_message_length };
    const control = opcode.is_control();
    if (control and payload_len > control_capacity) {
        return .{ .failed = .invalid_control_payload_length };
    }
    if (control and !fin) return .{ .failed = .expected_fin };
    const masked = role == .client and mask_frame;
    var key: ?zslay.MaskingKey = null;
    if (masked) {
        var chosen: zslay.MaskingKey = undefined;
        if (mask.len == 0) {
            header.draw_masking_key(&chosen) catch return .{ .failed = .protocol_error };
        } else {
            if (mask.len != chosen.len) return .{ .failed = .invalid_mask };
            @memcpy(&chosen, mask);
        }
        key = chosen;
    }
    if (out.len < 2) return .{ .failed = .unsupported_message_length };
    const base: zslay.types.FrameHeader = .{
        .fin = fin,
        .rsv1 = false,
        .rsv2 = false,
        .rsv3 = false,
        .opcode = @intFromEnum(opcode),
        .mask = masked,
        .payload_len = header.length_field(payload_len),
    };
    const written = zslay.frame.encode_header(out, base, payload_len, key) catch
        return .{ .failed = .protocol_error };
    return .{ .ok = written };
}
