//! The opaque handles that name a live codec, and the operations on one.
//!
//! The table itself is in `handles-table.zig`; this module is the handle arithmetic
//! and the three verbs a caller has. State and generation share one atomic word, so
//! a resolve can never pair a fresh generation with a stale state or observe a torn
//! transition. The generation rejects a handle after its codec is destroyed, so a
//! stale JavaScript call is a typed status instead of a use-after-free.

const std = @import("std");
const napi = @import("napi-zig");
const capacities = @import("capacities.zig");
const slot_word = @import("packed.zig");
const slots = @import("handles-table.zig");
const state = @import("state.zig");

/// Which side of the connection enforces masking. Defined by the table, because the
/// table is what holds it; re-exported here because this is the module a caller
/// reads the vocabulary from.
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

/// Why a create was refused.
pub const Error = error{ CodecTableFull, InvalidCapacity, UnknownCodec };

/// The codec the table holds.
pub const Codec = state.codec(
    capacities.max_message_bytes,
    capacities.control_slots,
    capacities.max_fragments,
);

/// One table entry.
const Slot = slots.Slot;

/// Claims a slot and builds a codec in it.
///
/// There is no capacity argument, and that is the point. A codec's message buffer is
/// comptime-sized, so every codec in this table has the same capacity; accepting a
/// smaller one and ignoring it would let an application believe it had negotiated a
/// `maxPayload` the codec would not honour, and the first oversized message would be
/// a 1009 nobody asked for. `capacities.max_message_bytes` is the one capacity, and
/// `engineLimits` is how a caller reads it.
pub fn create(role: Role, validate_utf8: bool) Error!Handle {
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
        peer.* = Codec.init(if (role == .client) .client else .server, validate_utf8);
        slot.codec = peer;
        slot.role = role;
        return .{ .index = @intCast(index), .generation = generation };
    }
    return error.CodecTableFull;
}

/// Resolves a handle, or null when the slot is free or the generation is stale.
///
/// A codec is only ever touched on the Node main thread, so no lock is needed and
/// the atomic word is only carrying the pair.
pub fn resolve(raw: u64) ?*Codec {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    return slot.codec;
}

/// Releases a codec and frees its slot. The generation is not reset, so a handle
/// from the previous occupant is still rejected.
pub fn destroy(raw: u64) void {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return;
    if (slot_word.generation_of(word) != handle.generation) return;
    // The slot is marked free first, so a second destroy for the same handle finds
    // a free slot and does not free the codec twice. Both run on the Node main
    // thread, and a codec is not reachable from any other thread.
    slot.word.store(slot_word.pack(.free, slot_word.generation_of(word)), .release);
    if (slot.codec) |peer| {
        slot.codec = null;
        allocator.destroy(peer);
    }
}

/// Where a codec's buffers come from and go back to.
///
/// A `smp_allocator` rather than the connection's, for the reason the engine's
/// `Instance` uses the same one: the buffer is only ever touched on the Node main
/// thread, and an allocator stored inside the state it allocates for is the shape
/// the conventions forbid.
const allocator = std.heap.smp_allocator;

/// Live codecs, for a test that asserts the table is balanced.
pub fn live_count() usize {
    var count: usize = 0;
    for (&slots.table) |*slot| {
        if (slot.codec != null) count += 1;
    }
    return count;
}

/// The role a slot was created with.
pub fn role_of(raw: u64) ?Role {
    const handle = Handle.from_int(raw);
    if (handle.index >= capacities.codec_capacity) return null;
    const slot = &slots.table[handle.index];
    const word = slot.word.load(.acquire);
    if (slot_word.state_of(word) != .active) return null;
    if (slot_word.generation_of(word) != handle.generation) return null;
    return slot.role;
}
