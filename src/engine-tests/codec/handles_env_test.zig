//! Environment-isolation cases for the bounded codec table: two distinct environments,
//! cross-environment refusals, the cleanup hook's register/remove pairing, and the teardown
//! drain. The table only ever compares `napi_env` values, so no live Node environment is
//! needed; the hook registration calls themselves need one and stay with the binding tests.

const std = @import("std");
const testing = std.testing;
const napi = @import("napi-zig");
const abi = @import("../../engine/ffi/codec_abi.zig");
const capacities = @import("../../engine/codec/capacities.zig");
const encode = @import("../../engine/ffi/codec_encode.zig");
const handles = @import("../../engine/codec/handles.zig");
const limits = @import("../../engine/codec/limits.zig");
const status = @import("../../engine/ffi/codec_status.zig");

const c = napi.c;

/// Dummy non-null environments. The table only compares them; it never dereferences them.
const env: c.napi_env = @ptrFromInt(0x1000);
const foreign: c.napi_env = @ptrFromInt(0x2000);

/// The compiled ceilings: the point of these cases is isolation, not limits.
const max_message = capacities.max_message_bytes;
const max_fragments = capacities.max_fragments;

fn with_limits(message_bytes: usize, fragment_count: usize) limits.Limits {
    return limits.Limits.trust(message_bytes, fragment_count, true, false) catch unreachable;
}

test "a handle from another environment is refused rather than followed" {
    // A Worker thread has its own `napi_env` and the table is process-wide, so a handle
    // acquired on one environment must not resolve, report, or destroy on another; the
    // owning environment is compared before the codec pointer is ever loaded.
    const raw = (try handles.create(env, .server, with_limits(max_message, max_fragments))).to_int();
    defer _ = handles.destroy(env, raw);
    try testing.expect(handles.resolve(foreign, raw) == null);
    try testing.expectEqual(@as(?handles.Role, null), handles.role_of(foreign, raw));
    try testing.expectEqual([2]usize{ 0, 0 }, handles.ceilings_of(foreign, raw));
    try testing.expect(!handles.destroy(foreign, raw));
    try testing.expect(handles.resolve(env, raw) != null);
    // An out-of-range index is refused rather than wrapping into a live slot.
    try testing.expect(handles.resolve(env, 0xffff_ffff_ffff_ffff) == null);
    try testing.expect(handles.resolve(env, capacities.codec_capacity) == null);
    try testing.expect(handles.role_of(env, 0xffff_ffff_ffff_ffff) == null);
}

test "destroy reports the environment's last codec for the hook pairing" {
    // The cleanup hook is registered with the environment's first codec and removed with
    // its last, so `destroy` has to report which one this was, without touching N-API.
    const first = try handles.create(env, .server, with_limits(max_message, max_fragments));
    const second = try handles.create(env, .server, with_limits(max_message, max_fragments));
    try testing.expectEqual(@as(usize, 2), handles.env_count(env));
    try testing.expect(!handles.destroy(env, first.to_int()));
    try testing.expectEqual(@as(usize, 1), handles.env_count(env));
    try testing.expect(handles.destroy(env, second.to_int()));
    try testing.expectEqual(@as(usize, 0), handles.env_count(env));

    // Another environment's live codec does not make this environment wait for its own.
    const mine = try handles.create(env, .server, with_limits(max_message, max_fragments));
    const other = try handles.create(foreign, .server, with_limits(max_message, max_fragments));
    try testing.expect(handles.destroy(env, mine.to_int()));
    try testing.expectEqual(@as(usize, 1), handles.live_count());
    _ = handles.destroy(foreign, other.to_int());
}

test "the environment drain frees only that environment's codecs" {
    // The cleanup hook body: an exiting environment releases every codec it still holds,
    // and a codec another environment owns stays resolvable.
    const first = try handles.create(env, .server, with_limits(max_message, max_fragments));
    const second = try handles.create(env, .client, with_limits(max_message, max_fragments));
    const other = try handles.create(foreign, .server, with_limits(max_message, max_fragments));
    handles.destroy_env(env);
    try testing.expectEqual(@as(usize, 0), handles.env_count(env));
    try testing.expectEqual(@as(usize, 1), handles.live_count());
    try testing.expect(handles.resolve(env, first.to_int()) == null);
    try testing.expect(handles.resolve(env, second.to_int()) == null);
    try testing.expect(handles.resolve(foreign, other.to_int()) != null);
    _ = handles.destroy(foreign, other.to_int());
}

test "the encode crossing refuses a foreign environment" {
    // The FFI wrappers resolve through the table, so a handle that encodes for its owner
    // must come back a plain stale-handle refusal for another environment, never a touch.
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const owner = napi.Env{ .handle = env, .arena = &arena };
    const stranger = napi.Env{ .handle = foreign, .arena = &arena };
    const raw = (try handles.create(env, .server, with_limits(max_message, max_fragments))).to_int();
    defer _ = handles.destroy(env, raw);
    try testing.expect(try encode.codec_encode(owner, raw, 1, 1, "payload", 0, 1, "") > 0);
    try testing.expectEqual(abi.encode_refusal(.stale_handle), try encode.codec_encode(stranger, raw, 1, 1, "payload", 0, 1, ""));
    try testing.expect(!try encode.codec_outbound_masked(stranger, raw));
    try testing.expectEqual(@as(abi.Count, 1), try status.codec_role(owner, raw));
    try testing.expectEqual(@as(abi.Count, -1), try status.codec_role(stranger, raw));
}
