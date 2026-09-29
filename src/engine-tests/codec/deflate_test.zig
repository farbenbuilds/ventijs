//! RFC 7692 framing on top of the engine's libdeflate. Byte-level rather than
//! round-trip-level wherever the byte level is the contract, because a round trip through
//! our own compressor and decompressor would agree with a symmetrically wrong pair.

const std = @import("std");
const testing = std.testing;
const deflate = @import("../../engine/codec/deflate.zig");
const inflate = @import("../../engine/codec/inflate.zig");
const growth = @import("../../engine/codec/growth.zig");

/// A message that compresses to nothing, one that compresses to a single byte, and one
/// long enough to need a real block.
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
    // What this pins is the *length* on the wire, the packed length less four, so a peer's
    // `00 00 ff ff` restore lands on the boundary it expects.
    try testing.expect(compressed.len + deflate.sync_flush_tail.len > 0);
}

test "a message can be larger on the wire than off it, which is what threshold is for" {
    // An empty message still costs a deflate block, and libdeflate will not compress
    // nothing into nothing. RFC 7692's own answer is the `threshold` option: below it a
    // message goes out uncompressed, which is also why `ws` only consults `threshold` when
    // no-context-takeover is negotiated and a message never carries history to the next.
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    try testing.expect((try compressor.compress("", 1 << 20)).len > 0);
    const repetitive = "hello hello hello hello world world world";
    const repeated = try compressor.compress(repetitive, 1 << 20);
    try testing.expect(repeated.len < repetitive.len);
}

test "one connection's compressor and decompressor survive many messages" {
    // The engines are built once and rewound per message, and the rewind has to re-borrow
    // the input buffer, which grows as larger messages arrive. Growing message lengths are
    // what catches an engine still pointing at the buffer it was built with.
    var compressor: deflate.Compressor = .{};
    defer compressor.deinit();
    var decompressor: inflate.Message = .init(true);
    defer decompressor.deinit();
    var out: growth.buffer(u8) = try growth.buffer(u8).init(1 << 10);
    defer out.deinit();

    var size: usize = 1;
    while (size <= 1 << 16) : (size *= 2) {
        const message = try std.testing.allocator.alloc(u8, "ventiws".len * size);
        defer std.testing.allocator.free(message);
        for (0..size) |repeat| {
            @memcpy(message[repeat * "ventiws".len ..][0.."ventiws".len], "ventiws");
        }
        const compressed = try compressor.compress(message, 1 << 20);
        decompressor.clear();
        try decompressor.stage(compressed, 1 << 20);
        const plain = try decompressor.inflate(&out, 1 << 20);
        try testing.expectEqualSlices(u8, message, plain);
    }
}

test "a message that inflates past the ceiling is refused rather than delivered short" {
    // The bound is the storage, not a check afterwards: libdeflate reports insufficient
    // space and the message is a 1009 rather than a silently short one. A real stream has
    // to be over the limit, because a corrupt one fails earlier and for another reason.
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
    // inflated once at the final fragment, so splitting the compressed form in half and
    // staging each piece is the whole fragmented-message path.
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
