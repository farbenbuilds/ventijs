//! The opaque handles that name a live codec, and the operations on one.
//!
//! The table itself is in `handles-table.zig`; this module is the handle arithmetic and
//! the verbs a caller has. State and generation share one atomic word, so a resolve can
//! never pair a fresh generation with a stale state, and a stale JavaScript call is a
//! typed status rather than a use-after-free.

const std = @import("std");
const napi = @import("napi-zig");
const capacities = @import("capacities.zig");
const slot_word = @import("packed.zig");
const slots = @import("handles-table.zig");
const limits = @import("limits.zig");
const state = @import("state.zig");

/// Which side of the connection enforces masking. Defined by the table, which holds
/// it, and re-exported because this is the module a caller reads it from.
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

/// One table entry.
/// Why a create was refused. The two limit errors are the caller's configuration and
/// the rest are the process's, so a refusal says which side of the boundary it came
/// from.
pub const Error = error{ CodecTableFull, InvalidMessageCap, InvalidCapacity, OutOfMemory };

/// The codec the table holds. One type for every connection in the process; the
/// per-connection ceilings are fields on it rather than parameters on it, so the
/// table is a table of one type and a connection with a 1 KiB `maxPayload` and one
/// with 100 MiB are the same kind of thing.
pub const Codec = state.codec(capacities.control_slots);

/// One table entry.
/// Claims a slot and builds a codec in it.
///
/// The two ceilings are arguments, and they are honoured exactly: `maxPayload` and
/// `maxFragments` are per-connection options in `ws`, so two connections in one
/// process have to be able to differ. `limits.trust` validates them and a request
/// above a ceiling is refused rather than clamped, because a caller that set
/// `maxPayload` and got something else has no way to find out.
///
/// The slot is claimed before the codec is built, so a failure has to put the slot
/// back; that is what the `errdefer` does, and it is why a server that opens more
/// connections than the table holds can retry rather than leak a slot per attempt.
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
        // Only the block is released here. `Codec.init` owns the cleanup of a codec
        // that got as far as allocating a message buffer and then failed, so a second
        // `deinit` here would free the same buffer twice -- and `peer` is uninitialized
        // until `init` returns, so there is nothing of its own to release.
        errdefer allocator.destroy(peer);
        peer.* = Codec.init(if (role == .client) .client else .server, trusted) catch |err| return err;
        slot.codec = peer;
        slot.role = role;
        return .{ .index = @intCast(index), .generation = generation };
    }
    return error.CodecTableFull;
}

/// Resolves a handle, or null when the slot is free or the generation is stale. A
/// codec is only ever touched on the Node main thread, so the atomic word only
/// carries the pair and needs no lock.
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
    // The slot is marked free first, so a second destroy finds a free slot and does
    // not free the codec twice. Both run on the Node main thread.
    slot.word.store(slot_word.pack(.free, slot_word.generation_of(word)), .release);
    if (slot.codec) |peer| {
        slot.codec = null;
        // Order matters: the buffers the codec grew are released before the block
        // that holds the pointers to them, and both after the slot is marked free so
        // a second destroy for the same handle finds a free slot and does neither.
        peer.deinit();
        allocator.destroy(peer);
    }
}

/// Where a codec's buffers come from and go back to. A `smp_allocator`, for the reason
/// the engine's `Instance` uses the same one: a codec is only touched on the Node main
/// thread, and an allocator stored inside the state it allocates for is forbidden.
const allocator = std.heap.smp_allocator;

/// Live codecs, for a test that asserts the table is balanced.
pub fn live_count() usize {
    var count: usize = 0;
    for (&slots.table) |*slot| {
        if (slot.codec != null) count += 1;
    }
    return count;
}

/// The per-connection ceilings a handle enforces, or zeroes for a stale one.
///
/// Read back rather than echoed: the only way to know the limit in force is to ask the
/// thing enforcing it, and `maxPayload: 0` is `ws`'s "no limit" rather than zero.
pub fn ceilings_of(raw: u64) [2]usize {
    const peer = resolve(raw) orelse return .{ 0, 0 };
    return .{ peer.rx.max_message_bytes, peer.rx.max_fragments_per_message };
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
