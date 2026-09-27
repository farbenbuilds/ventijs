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
const limits = @import("../../engine/codec/limits.zig");

/// The ceilings every case in this file uses. The point of the table is generations
/// and liveness, not limits, so these are the compiled ceilings and the tests below
/// that do care about limits ask for their own.
const max_message = capacities.max_message_bytes;
const max_fragments = capacities.max_fragments;

/// The limits every case here uses, built the way the table builds them.
fn with_limits(message_bytes: usize, fragment_count: usize) limits.Limits {
    return limits.Limits.trust(message_bytes, fragment_count, true, false) catch unreachable;
}

test "a created codec resolves through its handle" {
    const handle = try handles.create(.server, with_limits(max_message, max_fragments));
    defer handles.destroy(handle.to_int());
    try testing.expectEqual(@as(usize, 1), handles.live_count());
    try testing.expect(handles.resolve(handle.to_int()) != null);
    try testing.expectEqual(handles.Role.server, handles.role_of(handle.to_int()).?);
}

test "a destroyed codec stops resolving immediately" {
    const handle = try handles.create(.server, with_limits(max_message, max_fragments));
    const raw = handle.to_int();
    try testing.expect(handles.resolve(raw) != null);
    handles.destroy(raw);
    try testing.expect(handles.resolve(raw) == null);
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}

test "a reused slot hands out a fresh generation" {
    const first = try handles.create(.server, with_limits(max_message, max_fragments));
    const stale = first.to_int();
    handles.destroy(stale);

    const second = try handles.create(.client, with_limits(max_message, max_fragments));
    defer handles.destroy(second.to_int());
    try testing.expectEqual(first.index, second.index);
    try testing.expect(second.generation != first.generation);
    // The stale handle must not resolve to the new occupant, which is the whole
    // point of the generation rather than of the index alone.
    try testing.expect(handles.resolve(stale) == null);
    try testing.expect(handles.resolve(second.to_int()) != null);
}

test "a double destroy is a no-op rather than a double free" {
    const handle = try handles.create(.server, with_limits(max_message, max_fragments));
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

test "a ceiling above the compiled one is refused rather than clamped" {
    // The failure mode this replaced: a `maxPayload` normalized to 100 MiB, reported
    // on `server.options`, and then a different limit quietly enforced. A caller that
    // asked for more than the build supports has to be told, and told here, where the
    // option's name is still in scope.
    try testing.expectError(
        error.InvalidMessageCap,
        limits.Limits.trust(capacities.max_message_bytes + 1, max_fragments, true, false),
    );
    try testing.expectError(
        error.InvalidCapacity,
        limits.Limits.trust(max_message, capacities.max_fragments + 1, true, false),
    );
    // The record is the only way into `create`, so a value `trust` refused cannot
    // reach the table at all -- which is why nothing was leaked on the way out.
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}

test "a ceiling of 0 becomes the ceiling, because ws reads it as no limit" {
    // `ws` guards its length check with `_maxPayload > 0`, so a zero disables the
    // check. A codec has no guard to disable, so zero becomes the largest value it can
    // enforce, and the two ceilings are translated the same way.
    const none = try limits.Limits.trust(0, 0, true, false);
    try testing.expectEqual(limits.Limits.message_ceiling, none.max_message);
    try testing.expectEqual(limits.Limits.fragment_ceiling, none.max_fragments);
}

test "a handle reports the ceilings it was created with" {
    // Read back rather than echoed: the only way a caller can know the limit in force
    // is to ask the thing enforcing it.
    const handle = try handles.create(.server, with_limits(4096, 8));
    defer handles.destroy(handle.to_int());
    try testing.expectEqual([2]usize{ 4096, 8 }, handles.ceilings_of(handle.to_int()));
    try testing.expectEqual([2]usize{ 0, 0 }, handles.ceilings_of(0xffff_ffff_ffff_ffff));
}

test "the table is bounded" {
    // Every slot filled is a real allocation, so the test frees each one as it
    // goes rather than holding the table full.
    var created: [8]u64 = undefined;
    var filled: usize = 0;
    while (filled < created.len) : (filled += 1) {
        const handle = handles.create(.server, with_limits(max_message, max_fragments)) catch break;
        created[filled] = handle.to_int();
    }
    try testing.expectEqual(created.len, filled);
    for (created[0..filled]) |raw| handles.destroy(raw);
    try testing.expectEqual(@as(usize, 0), handles.live_count());
}
