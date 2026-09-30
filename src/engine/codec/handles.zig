//! The opaque handles that name a live codec, and the verbs on one; the table itself is in
//! `handles-table.zig`. State and generation share one atomic word, so a resolve can never
//! pair a fresh generation with a stale state, and every verb compares the owning
//! environment first, so one worker never touches another worker's codec.

const std = @import("std");
const napi = @import("napi-zig");
const capacities = @import("capacities.zig");
const slot_word = @import("packed.zig");
const slots = @import("handles-table.zig");
const limits = @import("limits.zig");
const state = @import("state.zig");

const c = napi.c;

/// Which side enforces masking; re-exported because this is the module a caller reads it from.
pub const Role = slots.Role;

/// Opaque codec handle: 32 bit index, 32 bit generation.
pub const Handle = struct {
    index: u32,
    generation: u32,

    pub fn to_int(handle: Handle) u64 {
        return (@as(u64, handle.generation) << 32) | @as(u64, handle.index);
    }

    pub fn from_int(raw: u64) Handle {
        return .{ .index = @truncate(raw), .generation = @truncate(raw >> 32) };
    }
};

/// The two limit errors are the caller's configuration and the rest are the process's, so
/// a refusal says which side of the boundary it came from.
pub const Error = error{ CodecTableFull, InvalidMessageCap, InvalidCapacity, OutOfMemory };

/// One type for every connection: the per-connection ceilings are fields rather than
/// parameters, so a 1 KiB and a 100 MiB connection are the same kind of thing.
pub const Codec = state.codec(capacities.control_slots);

/// Live codecs, for a test that asserts the table is balanced.
pub const live_count = slots.live_count;

/// Live codecs owned by `env`, for the cleanup hook's register/remove pairing.
pub const env_count = slots.env_count;

/// The two ceilings are honoured exactly: `maxPayload` and `maxFragments` are
/// per-connection options in `ws`, so a request above one is refused rather than clamped
/// -- a caller that set `maxPayload` and got something else cannot find out.
pub fn create(env: c.napi_env, role: Role, trusted: limits.Limits) Error!Handle {
    var index: usize = 0;
    while (index < capacities.codec_capacity) : (index += 1) {
        const slot = &slots.table[index];
        const word = slot.word.load(.acquire);
        if (slot_word.state_of(word) != .free) continue;
        const generation = slot_word.generation_of(word) +% 1;
        if (slot.word.cmpxchgWeak(word, slot_word.pack(.active, generation), .acq_rel, .acquire) != null) {
            continue;
        }
        errdefer slot.word.store(slot_word.pack(.free, generation), .release);
        const peer = allocator.create(Codec) catch return error.OutOfMemory;
        // Only the block is released here: `Codec.init` owns the cleanup of a half-built
        // codec, so a second `deinit` would double-free, and `peer` has no fields of its own.
        errdefer allocator.destroy(peer);
        peer.* = Codec.init(if (role == .client) .client else .server, trusted) catch |err| return err;
        // The environment is published before the pointer, because a foreign resolve must
        // reject on the environment before it can reach a codec it has no claim to.
        slot.env.store(env, .release);
        slot.role.store(role, .release);
        slot.codec.store(peer, .release);
        return .{ .index = @intCast(index), .generation = generation };
    }
    return error.CodecTableFull;
}

/// Resolves a handle owned by `env`, or null when the slot is free, the generation is
/// stale, or another environment owns it. All three checks precede the pointer load, so a
/// worker never observes a codec its environment has no claim to.
pub fn resolve(env: c.napi_env, raw: u64) ?*Codec {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    if (slot.env.load(.acquire) != env) return null;
    return slot.codec.load(.acquire);
}

/// Destroys a handle owned by `env`, and reports whether it was the environment's last live
/// codec so the caller removes its cleanup hook. A free slot, a stale generation, and a
/// foreign environment are no-ops; the CAS releases the slot before the codec is freed, so
/// two concurrent destroys free it exactly once.
pub fn destroy(env: c.napi_env, raw: u64) bool {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return false;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return false;
    if (slot_word.generation_of(word) != handle.generation) return false;
    if (slot.env.load(.acquire) != env) return false;
    // The pointer is loaded before the release: a create can only claim a free slot, so a
    // won CAS proves this pointer still belongs to this generation.
    const peer = slot.codec.load(.acquire);
    if (slot.word.cmpxchgStrong(word, slot_word.pack(.free, handle.generation), .acq_rel, .acquire) != null) {
        return false;
    }
    if (peer) |codec| {
        codec.deinit();
        allocator.destroy(codec);
    }
    return env_count(env) == 0;
}

/// Destroys every codec owned by `env`, for the environment-teardown hook. The state and
/// environment checks mean the drain reaches nothing after an explicit destroy, or for a
/// slot a different environment has since claimed.
pub fn destroy_env(env: c.napi_env) void {
    for (&slots.table, 0..) |*slot, index| {
        const word = slot.word.load(.acquire);
        if (slot_word.state_of(word) != .active) continue;
        if (slot.env.load(.acquire) != env) continue;
        const raw = (Handle{ .index = @intCast(index), .generation = slot_word.generation_of(word) }).to_int();
        _ = destroy(env, raw);
    }
}

/// A codec is only touched by the environment that created it, and an allocator stored
/// inside the state it allocates for is forbidden.
const allocator = std.heap.smp_allocator;

/// Read back rather than echoed: `maxPayload: 0` is `ws`'s "no limit", not zero.
pub fn ceilings_of(env: c.napi_env, raw: u64) [2]usize {
    const peer = resolve(env, raw) orelse return .{ 0, 0 };
    return .{ peer.rx.max_message_bytes, peer.rx.max_fragments_per_message };
}

pub fn role_of(env: c.napi_env, raw: u64) ?Role {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    if (slot.env.load(.acquire) != env) return null;
    return slot.role.load(.acquire);
}
