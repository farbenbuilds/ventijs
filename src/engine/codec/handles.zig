//! The opaque handles that name a live codec, and the verbs on one; the table itself is in
//! `handles-table.zig`. State and generation share one atomic word, so a resolve can never
//! pair a fresh generation with a stale state.

const std = @import("std");
const napi = @import("napi-zig");
const capacities = @import("capacities.zig");
const slot_word = @import("packed.zig");
const slots = @import("handles-table.zig");
const limits = @import("limits.zig");
const state = @import("state.zig");

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

/// The two ceilings are honoured exactly: `maxPayload` and `maxFragments` are
/// per-connection options in `ws`, so a request above one is refused rather than clamped
/// -- a caller that set `maxPayload` and got something else cannot find out.
pub fn create(role: Role, trusted: limits.Limits) Error!Handle {
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
        const peer = allocator.create(Codec) catch return error.CodecTableFull;
        // Only the block is released here: `Codec.init` owns the cleanup of a half-built
        // codec, so a second `deinit` would double-free, and `peer` has no fields of its own.
        errdefer allocator.destroy(peer);
        peer.* = Codec.init(if (role == .client) .client else .server, trusted) catch |err| return err;
        slot.codec = peer;
        slot.role = role;
        return .{ .index = @intCast(index), .generation = generation };
    }
    return error.CodecTableFull;
}

/// Resolves a handle, or null when the slot is free or the generation is stale. A codec is
/// only ever touched on the Node main thread, so the atomic word needs no lock.
pub fn resolve(raw: u64) ?*Codec {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    return slot.codec;
}

/// The generation is not reset, so a handle from the previous occupant is still rejected.
pub fn destroy(raw: u64) void {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return;
    if (slot_word.generation_of(word) != handle.generation) return;
    // The slot is marked free first, so a second destroy cannot free the codec twice.
    slot.word.store(slot_word.pack(.free, slot_word.generation_of(word)), .release);
    if (slot.codec) |peer| {
        slot.codec = null;
        // The codec's buffers are released before the block holding pointers to them.
        peer.deinit();
        allocator.destroy(peer);
    }
}

/// A codec is only touched on the Node main thread, and an allocator stored inside the state it allocates for is forbidden.
const allocator = std.heap.smp_allocator;

/// Live codecs, for a test that asserts the table is balanced.
pub fn live_count() usize {
    var count: usize = 0;
    for (&slots.table) |*slot| {
        if (slot.codec != null) count += 1;
    }
    return count;
}

/// Read back rather than echoed: `maxPayload: 0` is `ws`'s "no limit", not zero.
pub fn ceilings_of(raw: u64) [2]usize {
    const peer = resolve(raw) orelse return .{ 0, 0 };
    return .{ peer.rx.max_message_bytes, peer.rx.max_fragments_per_message };
}

pub fn role_of(raw: u64) ?Role {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    return slot.role;
}
