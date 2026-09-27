//! Frame header layout: the length field, the opcode, and the masking key.
//!
//! Three small pure functions that only the transmit path uses, split out so the
//! rule they encode is stated once. That rule is the reason nothing above this
//! layer computes a frame size: the seven-bit length field has three encodings
//! and getting one of them wrong puts a header on the wire that disagrees with
//! the payload behind it, which is not something a peer can recover from.

const std = @import("std");
const zslay = @import("zslay");
const events = @import("events.zig");

const Kind = events.Kind;

/// The seven-bit length field's encoding: 0-125 inline, 126 for a two-byte
/// length, 127 for an eight-byte one.
pub fn length_field(len: usize) u7 {
    if (len > std.math.maxInt(u16)) return 127;
    if (len >= 126) return 126;
    return @intCast(len);
}

/// The wire opcode for an event kind, or null when the kind is not something a
/// caller may send. `rejected` is the one that has no frame: it reports a frame
/// the codec refused, so it has no frame to send.
pub fn wire_opcode(kind: Kind) ?zslay.Opcode {
    return switch (kind) {
        .text => .text,
        .binary => .binary,
        .ping => .ping,
        .pong => .pong,
        .close => .close,
        .rejected => null,
    };
}

/// Draws a masking key from the operating system.
///
/// RFC 6455 section 5.3 requires a fresh, unpredictable key per frame from a
/// client, because the mask exists to stop a malicious script on the peer from
/// poisoning a proxy's cache with bytes of its own choosing. A predictable key is
/// not a slow mask, it is no mask, so this reads `randomSecure` and a failure is
/// reported rather than papered over with a weak source.
///
/// The `Threaded` is built per call rather than held in a module-level variable,
/// and the reason is that it is safe to: `init_single_threaded` installs no
/// signal handler, opens no descriptors, and takes no allocator, so constructing
/// one is a struct of constants and the operating system is the only thing it
/// touches. A module-level `var` here would be the hidden global the conventions
/// forbid, and a seeded generator carried between frames would make every mask on
/// the connection predictable from the first one.
pub fn draw_masking_key(key: *zslay.MaskingKey) !void {
    var source: std.Io.Threaded = std.Io.Threaded.init_single_threaded;
    source.io().randomSecure(key) catch return error.RandomSourceUnavailable;
}
