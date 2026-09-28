//! Differential against `std.unicode`: too strict rejects a message the RFC allows.

const std = @import("std");
const testing = std.testing;
const utf8 = @import("../../engine/codec/utf8.zig");

/// Every lead-class boundary and the first and last byte of each continuation range.
const interesting = [_]u8{
    0x00, 0x01, 0x41, 0x7e, 0x7f,
    0x80, 0x81, 0xbe, 0xbf,
    0xc0, 0xc1, 0xc2, 0xdf, // 0xc0 and 0xc1 can lead an overlong form
    0xe0, 0xe1, 0xec, 0xed,
    0xee, 0xef,
    0xa0, 0x9f, // the two edges of 0xed's narrowed range
    0xf0, 0xf1, 0xf3, 0xf4, 0xf5, // 0xf5 leads past U+10FFFF
    0x90, 0x8f, // the two edges of 0xf0's and 0xf4's narrowed range
    0xfe, 0xff,
};

/// Folds a buffer one byte at a time, the harshest split. `feed` rejects a byte that
/// cannot begin or continue, `complete` rejects a message ending mid-sequence.
fn mine_validates(buffer: []const u8) bool {
    var state = utf8.State{};
    for (buffer) |byte| {
        state = utf8.feed(state, &.{byte}) orelse return false;
    }
    return utf8.complete(state);
}

fn expect_agreement(buffer: []const u8) !void {
    try testing.expectEqual(
        std.unicode.utf8ValidateSlice(buffer),
        mine_validates(buffer),
    );
}

test "every sequence of up to three interesting bytes agrees with std" {
    var buffer: [3]u8 = undefined;
    var prng = std.Random.DefaultPrng.init(0x5eed_1234);

    for (0..interesting.len) |first| {
        buffer[0] = interesting[first];
        try expect_agreement(buffer[0..1]);

        for (0..interesting.len) |second| {
            buffer[1] = interesting[second];
            try expect_agreement(buffer[0..2]);

            for (0..interesting.len) |third| {
                buffer[2] = interesting[third];
                try expect_agreement(buffer[0..3]);
            }
        }
    }

    // A randomized sweep, so the interesting set is a starting point rather than the search.
    for (0..20_000) |_| {
        const len = 1 + prng.random().uintLessThan(usize, 3);
        for (0..len) |index| buffer[index] = prng.random().int(u8);
        try expect_agreement(buffer[0..len]);
    }
}

test "a valid sequence split at every point is still valid" {
    const sequences = [_][]const u8{
        "hello",
        "\xc3\xa9", // U+00E9
        "\xe2\x82\xac", // U+20AC
        "\xf0\x9f\x92\xa9", // U+1F4A9, four bytes
        "\xef\xbf\xbd", // U+FFFD
    };
    for (sequences) |sequence| {
        for (0..sequence.len) |split| {
            var state = utf8.feed(.{}, sequence[0..split]) orelse return error.FalseRejection;
            state = utf8.feed(state, sequence[split..]) orelse return error.FalseRejection;
            try testing.expect(utf8.complete(state));
        }
    }
}

test "a sequence truncated at the end is invalid however it was split" {
    // Every byte it saw was in range and the message is still invalid.
    const sequences = [_][]const u8{ "\xc3", "\xe2\x82", "\xf0\x9f\x92", "\xed\x9f" };
    for (sequences) |sequence| {
        for (0..sequence.len) |split| {
            var state = utf8.feed(.{}, sequence[0..split]) orelse return error.FalseRejection;
            state = utf8.feed(state, sequence[split..]) orelse return error.FalseRejection;
            try testing.expect(!utf8.complete(state));
        }
    }
}

test "the narrowings are the only reason a lead byte is special" {
    // Each is a sequence `std` rejects and a naive `0x80..0xbf` range would accept.
    const rejected = [_][]const u8{
        "\xc0\x80",
        "\xc1\xbf",
        "\xe0\x80\x80",
        "\xe0\x9f\xbf",
        "\xed\xa0\x80", // U+D800, a surrogate half
        "\xed\xbf\xbf",
        "\xf0\x80\x80\x80",
        "\xf0\x8f\xbf\xbf",
        "\xf4\x90\x80\x80", // U+110000, past the last codepoint
        "\xf5\x80\x80\x80",
        "\xc2",
        "\x80", // a stray continuation
        "\xfe",
    };
    for (rejected) |sequence| try expect_agreement(sequence);
}
