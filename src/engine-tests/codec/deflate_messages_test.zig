//! One connection, more than one compressed message: RFC 7692 section 7.2.2 makes every
//! message its own deflate stream, so no message may inflate the one before it.

const std = @import("std");
const testing = std.testing;
const deflate = @import("../../engine/codec/deflate.zig");
const codec = @import("../../engine/codec/state.zig");
const limits = @import("../../engine/codec/limits.zig");
const support = @import("frame_support.zig");

const Peer = codec.codec(8);
const KEY = [4]u8{ 1, 2, 3, 4 };

/// Without `permessage-deflate` negotiated RSV1 is a refusal before any message reaches the
/// inflate state, which would make every case here pass for the wrong reason.
fn negotiated() Peer {
    const trusted = limits.Limits.trust(4096, 8, true, true) catch unreachable;
    return Peer.init(.server, trusted) catch unreachable;
}

/// A masked client frame carrying a compressed text message, built from the compressor so
/// the bytes are a real stream rather than a fixture this suite could round-trip by accident.
fn compressed(buffer: []u8, compressor: *deflate.Compressor, message: []const u8) []const u8 {
    const payload = compressor.compress(message, 1 << 20) catch unreachable;
    const built = support.raw_frame(buffer, true, 0x1, @intCast(payload.len), true, KEY, payload);
    buffer[0] |= 0x40;
    return buffer[0..built.len];
}

fn plain(buffer: []u8, message: []const u8) []const u8 {
    const built = support.raw_frame(buffer, true, 0x1, @intCast(message.len), true, KEY, message);
    return buffer[0..built.len];
}

test "a second compressed message inflates its own bytes, not the first message's" {
    var peer = negotiated();
    defer peer.deinit();
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();

    var buffer: [128]u8 = undefined;
    _ = peer.feed(compressed(&buffer, &compressor, "first message"));
    const first = try support.take_only(&peer);
    try testing.expectEqualStrings("first message", first.payload);
    _ = peer.feed(compressed(&buffer, &compressor, "second message"));
    const second = try support.take_only(&peer);
    try testing.expectEqualStrings("second message", second.payload);
}

test "an uncompressed message after a compressed one is delivered as itself" {
    // Kept from the compressed message before it, the latch staged this message's bytes and
    // inflated them, which is a 1007 or the previous message, never this one.
    var peer = negotiated();
    defer peer.deinit();
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();

    var buffer: [128]u8 = undefined;
    _ = peer.feed(compressed(&buffer, &compressor, "compressed"));
    _ = try support.take_only(&peer);
    _ = peer.feed(plain(&buffer, "plain text"));
    const delivered = try support.take_only(&peer);
    try testing.expectEqualStrings("plain text", delivered.payload);
}

test "compressed text that inflates to invalid UTF-8 is a 1007" {
    // The staged bytes never reached the incremental validator, so validation has to run on
    // the inflated message: `0xed 0xa0 0x80` is UTF-8-encoded U+D800, a surrogate.
    var peer = negotiated();
    defer peer.deinit();
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();

    var buffer: [128]u8 = undefined;
    _ = peer.feed(compressed(&buffer, &compressor, &.{ 0xed, 0xa0, 0x80 }));
    try testing.expectEqual(codec.Failure.invalid_utf8, peer.pending_failure().?);
    try testing.expectEqual(@as(u16, 1007), peer.failure_code());
}
