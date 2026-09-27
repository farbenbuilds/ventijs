//! Differential test of the incremental validator against `std.unicode`.
//!
//! A hand-written UTF-8 state machine is exactly the kind of code that looks
//! right, so the test does not enumerate cases by hand. It generates every
//! sequence of up to three bytes over a set of interesting lead and continuation
//! values, plus a randomized sweep, and requires that the incremental answer and
//! `std.unicode.utf8ValidateSlice` agree on every split point. A disagreement in
//! either direction is a bug: too strict rejects a message the RFC allows, and
//! too loose delivers one it forbids.

const std = @import("std");
const testing = std.testing;
const utf8 = @import("../../engine/codec/utf8.zig");

/// The bytes that decide validity: every lead-class boundary, the first and last
/// byte of every continuation range, and the values just outside each range.
const interesting = [_]u8{
    0x00, 0x01, 0x41, 0x7e, 0x7f, // ASCII
    0x80, 0x81, 0xbe, 0xbf, // stray continuations
    0xc0, 0xc1, 0xc2, 0xdf, // two-byte leads, overlong included
    0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, // three-byte leads
    0xa0, 0x9f, // the two edges of 0xED's narrowed range
    0xf0, 0xf1, 0xf3, 0xf4, 0xf5, // four-byte leads, past-U+10FFFF included
    0x90, 0x8f, // the two edges of 0xF0's and 0xF4's narrowed range
    0xfe, 0xff, // never a lead byte
};

/// Folds a whole buffer the way a connection does, one byte at a time, and
/// answers whether the message would be delivered.
///
/// Byte by byte is the harshest split and the one a peer controls. The two
/// halves of the answer are distinct on purpose: `feed` rejects a byte that
/// cannot begin or continue a sequence, and `complete` rejects a message that
/// ends mid-sequence. `std` answers one question, so both halves are needed to
/// compare against it, and conflating them is the mistake this test exists to
/// catch: a buffer of `0xc3` contains no bad byte and is still not valid UTF-8.
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

    // A randomized sweep over the whole byte range, so the interesting set is a
    // starting point rather than the whole search.
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
    // The case a chunk-by-chunk validator that never checks its end state would
    // accept: every byte it saw was in range, and the message is still invalid.
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
    // Each of these is a sequence `std` rejects and a naive `0x80..0xbf`
    // continuation range would accept, which is why the range narrows on these
    // four lead bytes and no others.
    const rejected = [_][]const u8{
        "\xc0\x80", // overlong NUL
        "\xc1\xbf", // overlong
        "\xe0\x80\x80", // overlong
        "\xe0\x9f\xbf", // overlong
        "\xed\xa0\x80", // U+D800, a surrogate half
        "\xed\xbf\xbf", // U+DFFF
        "\xf0\x80\x80\x80", // overlong
        "\xf0\x8f\xbf\xbf", // overlong
        "\xf4\x90\x80\x80", // U+110000, past the last codepoint
        "\xf5\x80\x80\x80", // never a codepoint
        "\xc2", // a two-byte lead with no continuation
        "\x80", // a stray continuation
        "\xfe", // never a lead byte
    };
    for (rejected) |sequence| try expect_agreement(sequence);
}
