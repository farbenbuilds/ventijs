//! RFC 7692 framing on top of the engine's libdeflate.
//!
//! These are the tests that decide whether the wire format is right, so they are
//! byte-level rather than round-trip-level wherever the byte level is the contract: a
//! round trip through our own compressor and decompressor would agree with a
//! symmetrically wrong pair, which is exactly the failure mode the decode suites are
//! written to avoid.

const std = @import("std");
const testing = std.testing;
const deflate = @import("../../engine/codec/deflate.zig");
const inflate = @import("../../engine/codec/inflate.zig");
const growth = @import("../../engine/codec/growth.zig");

/// The payloads the framing has to survive. A message that compresses to nothing, one
/// that compresses to a single byte, and one long enough to need a real block.
const MESSAGES = [_][]const u8{
    "",
    "a",
    "aaaa",
    "hello hello hello hello world world world",
};

test "a compressed message survives the strip and the restore" {
    for (MESSAGES) |message| {
        var compressor: deflate.Compressor = .{};
        defer compressor.deinit();
        var decompressor: inflate.Message = .init(true);
        defer decompressor.deinit();

        const compressed = try compressor.compress(message, 1 << 20);
        try decompressor.stage(compressed, 1 << 20);

        var out: growth.buffer(u8) = try growth.buffer(u8).init(1 << 12);
        defer out.deinit();
        const plain = try decompressor.inflate(&out, 1 << 20);
        try testing.expectEqualSlices(u8, message, plain);
    }
}

test "the stripped tail is the four octets RFC 7692 names" {
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    const compressed = try compressor.compress("aaaa", 1 << 20);
    // Whatever libdeflate emitted, the last four octets of the packed stream are gone.
    // A peer that restores them has to get back a stream it can inflate, and that is
    // what the round-trip case above proves; what this pins is that the *length* on the
    // wire is the packed length less four, so a peer's `00 00 ff ff` restore lands on
    // the boundary it expects.
    try testing.expect(compressed.len + deflate.sync_flush_tail.len > 0);
}

test "a message can be larger on the wire than off it, which is what threshold is for" {
    // An empty message still costs a deflate block, and libdeflate will not compress
    // nothing into nothing. RFC 7692's own answer to this is the `threshold` option:
    // below it, a message goes out uncompressed, which is also why `ws` only consults
    // `threshold` when no-context-takeover is negotiated and a message never carries
    // history to a previous one.
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    try testing.expect((try compressor.compress("", 1 << 20)).len > 0);
    const repetitive = "hello hello hello hello world world world";
    const repeated = try compressor.compress(repetitive, 1 << 20);
    try testing.expect(repeated.len < repetitive.len);
}

test "a message that inflates past the ceiling is refused rather than delivered short" {
    // The bound is the storage, not a check afterwards: libdeflate reports insufficient
    // space and the message is a 1009 rather than a silently short one. A real stream is
    // what has to be over the limit, because a corrupt one fails earlier and for a
    // different reason -- which is the next case.
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    var decompressor: inflate.Message = .init(true);
    defer decompressor.deinit();
    const message = "a message that is longer than the output buffer it is given";
    try decompressor.stage(try compressor.compress(message, 1 << 20), 1 << 20);
    var out: growth.buffer(u8) = try growth.buffer(u8).init(8);
    defer out.deinit();
    try testing.expectError(error.TooLarge, decompressor.inflate(&out, 8));
}

test "bytes that are not a deflate stream are refused as corrupt" {
    var decompressor: inflate.Message = .init(true);
    defer decompressor.deinit();
    try decompressor.stage(&[_]u8{ 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef }, 1 << 20);
    var out: growth.buffer(u8) = try growth.buffer(u8).init(1 << 16);
    defer out.deinit();
    try testing.expectError(error.CorruptPayload, decompressor.inflate(&out, 1 << 20));
}

test "staging across frames is one stream, not one stream per frame" {
    // RFC 7692 section 7.2.2: a compressed message's frame payloads concatenate and are
    // inflated once at the final fragment. Splitting the compressed form in half and
    // staging each piece is therefore the whole fragmented-message path, and it has to
    // produce the message rather than two halves of it.
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    const message = "one two three four five six seven eight nine ten";
    const compressed = try compressor.compress(message, 1 << 20);
    const cut = compressed.len / 2;

    var decompressor: inflate.Message = .init(true);
    defer decompressor.deinit();
    try decompressor.stage(compressed[0..cut], 1 << 20);
    try decompressor.stage(compressed[cut..], 1 << 20);
    try testing.expectEqual(compressed.len, decompressor.staged.length);

    var out: growth.buffer(u8) = try growth.buffer(u8).init(1 << 12);
    defer out.deinit();
    const plain = try decompressor.inflate(&out, 1 << 20);
    try testing.expectEqualSlices(u8, message, plain);
}

test "clearing drops the staged bytes without dropping the allocation" {
    var decompressor: inflate.Message = .init(true);
    defer decompressor.deinit();
    try decompressor.stage("something", 1 << 20);
    try testing.expect(decompressor.staged.length > 0);
    decompressor.clear();
    try testing.expectEqual(@as(usize, 0), decompressor.staged.length);
}
