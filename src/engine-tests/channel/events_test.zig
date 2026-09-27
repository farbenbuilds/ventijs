//! Unit tests for `src/engine/channel/events.zig`.

const std = @import("std");
const events = @import("../../engine/channel/events.zig");

test "events default the connection fields to zero" {
    const event = events.Event{ .kind = .connection_open, .server = 3 };
    try std.testing.expectEqual(@as(u32, 0), event.index);
    try std.testing.expectEqual(@as(u32, 0), event.generation);
    try std.testing.expectEqual(@as(u32, 0), event.code);
}

test "event kind tag names stay pinned to the binding vocabulary" {
    // The bridge serializes a kind as `snakeToCamel(@tagName(tag))`, so the name
    // crossing into JavaScript is the camelCase form of the tag below. Zig owns
    // the tag and `napi-zig` owns the transform, so pinning the tag is what
    // catches a rename that would break `EngineEventKind` in
    // `src/binding/native.ts`. Pinning ordinals instead would have asserted
    // something the wire never carries.
    const expected = [_][]const u8{
        "listening",
        "connection_open",
        "connection_message",
        "connection_close",
        "engine_error",
        "server_closed",
    };
    const fields = @typeInfo(events.Kind).@"enum".fields;
    try std.testing.expectEqual(expected.len, fields.len);
    inline for (expected, fields) |name, field| {
        try std.testing.expectEqualStrings(name, field.name);
    }
}
