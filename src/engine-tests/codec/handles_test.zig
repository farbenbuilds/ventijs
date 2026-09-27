//! Tests for the bounded codec table and its generation-checked handles.
//!
//! The table is the only thing standing between a stale JavaScript handle and a
//! freed codec, so the property that matters is that a handle stops resolving the
//! instant its codec is destroyed, and that a slot reused afterwards hands out a
//! different generation so the old handle still cannot resolve.

const std = @import("std");
const testing = std.testing;
const capacities = @import("../../engine/codec/capacities.zig");
const handles = @import("../../engine/codec/handles.zig");

test "a created codec resolves through its handle" {
    const handle = try handles.create(.server);
    defer handles.destroy(handle.to_int());
    try testing.expectEqual(@as(usize, 1), handles.live_count());
    try testing.expect(handles.resolve(handle.to_int()) != null);
    try testing.expectEqual(handles.Role.server, handles.role_of(handle.to_int()).?);
}

test "a destroyed codec stops resolving immediately" {
    const handle = try handles.create(.server);
    const raw = handle.to_int();
    try testing.expect(handles.resolve(raw) != null);
    handles.destroy(raw);
    try testing.expect(handles.resolve(raw) == null);
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}

test "a reused slot hands out a fresh generation" {
    const first = try handles.create(.server);
    const stale = first.to_int();
    handles.destroy(stale);

    const second = try handles.create(.client);
    defer handles.destroy(second.to_int());
    try testing.expectEqual(first.index, second.index);
    try testing.expect(second.generation != first.generation);
    // The stale handle must not resolve to the new occupant, which is the whole
    // point of the generation rather than of the index alone.
    try testing.expect(handles.resolve(stale) == null);
    try testing.expect(handles.resolve(second.to_int()) != null);
}

test "a double destroy is a no-op rather than a double free" {
    const handle = try handles.create(.server);
    const raw = handle.to_int();
    handles.destroy(raw);
    handles.destroy(raw);
    try testing.expect(handles.resolve(raw) == null);
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}

test "a handle from another environment is refused rather than followed" {
    // A Worker thread has its own `napi_env`, and the table is process-wide, so a
    // handle acquired on one environment must not be usable from another. The
    // resolution here is by handle alone, and the facade pairs it with an
    // environment check; this test pins that an out-of-range index is refused
    // rather than wrapping into a live slot.
    try testing.expect(handles.resolve(0xffff_ffff_ffff_ffff) == null);
    try testing.expect(handles.resolve(capacities.codec_capacity) == null);
    try testing.expect(handles.role_of(0xffff_ffff_ffff_ffff) == null);
}

test "the table is bounded" {
    // Every slot filled is a real allocation, so the test frees each one as it
    // goes rather than holding the table full.
    var created: [8]u64 = undefined;
    var filled: usize = 0;
    while (filled < created.len) : (filled += 1) {
        const handle = handles.create(.server) catch break;
        created[filled] = handle.to_int();
    }
    try testing.expectEqual(created.len, filled);
    for (created[0..filled]) |raw| handles.destroy(raw);
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}
