//! Bounded slot table binding context-free engine callbacks to their state, since the
//! engine callback ABI passes no user pointer. A handle carries a generation, so a stale
//! JavaScript handle resolves to null rather than a recycled server.

const std = @import("std");
const napi = @import("napi-zig");

const c = napi.c;

/// Packed server handle: generation in the high bits, slot in the low byte. Returned to
/// JavaScript as a `u40` number, well inside the safe-integer range, so a recycled slot
/// cannot be addressed by a stale handle.
pub const Handle = struct {
    slot: u8,
    generation: u32,

    pub fn to_int(handle: Handle) u40 {
        return (@as(u40, handle.generation) << 8) | @as(u40, handle.slot);
    }

    pub fn from_int(raw: u40) Handle {
        return .{ .slot = @truncate(raw), .generation = @truncate(raw >> 8) };
    }
};

/// Builds a fixed-capacity slot table of at most 32 entries.
pub fn slot_table(comptime capacity: usize, comptime T: type) type {
    if (capacity == 0 or capacity > 32) {
        @compileError("slot table capacity must be between 1 and 32");
    }
    const all_claimed: u32 = if (capacity == 32)
        std.math.maxInt(u32)
    else
        (@as(u32, 1) << @intCast(capacity)) - 1;

    return struct {
        const Self = @This();

        slots: [capacity]std.atomic.Value(?*T) =
            [_]std.atomic.Value(?*T){std.atomic.Value(?*T).init(null)} ** capacity,
        envs: [capacity]std.atomic.Value(?c.napi_env) =
            [_]std.atomic.Value(?c.napi_env){std.atomic.Value(?c.napi_env).init(null)} ** capacity,
        generations: [capacity]std.atomic.Value(u32) =
            [_]std.atomic.Value(u32){std.atomic.Value(u32).init(0)} ** capacity,
        claimed: std.atomic.Value(u32) = .init(0),

        /// Reserves the lowest free slot. The CAS loop terminates because `claimed` only
        /// ever gains bits and the table has at most 32 of them.
        pub fn claim(table: *Self) !Handle {
            var current = table.claimed.load(.acquire);
            while (true) {
                if (current == all_claimed) return error.CapacityExhausted;
                const slot: u5 = @intCast(@ctz(~current));
                const next = current | (@as(u32, 1) << slot);
                if (table.claimed.cmpxchgWeak(current, next, .acq_rel, .monotonic)) |actual| {
                    current = actual;
                    continue;
                }
                const generation = table.generations[slot].fetchAdd(1, .acq_rel) +% 1;
                return .{ .slot = @intCast(slot), .generation = generation };
            }
        }

        /// Makes a claimed slot resolvable and records its owning environment.
        /// Call after the value is fully built.
        pub fn publish(table: *Self, handle: Handle, item: *T, env: c.napi_env) void {
            if (handle.slot >= capacity) return;
            table.envs[handle.slot].store(env, .release);
            table.slots[handle.slot].store(item, .release);
        }

        /// Rejects free slots, stale generations, and handles owned by another
        /// environment. The environment is compared before the instance pointer is loaded,
        /// so a worker cannot observe an instance another worker is tearing down.
        pub fn lookup(table: *Self, handle: Handle, env: c.napi_env) ?*T {
            if (handle.slot >= capacity) return null;
            if (table.generations[handle.slot].load(.acquire) != handle.generation) return null;
            if (table.envs[handle.slot].load(.acquire) != env) return null;
            return table.slots[handle.slot].load(.acquire);
        }

        /// Engine-thread lookup for a comptime trampoline slot, which is trusted at
        /// compile time, so the generation and environment checks are skipped.
        pub fn lookup_slot(table: *Self, slot: u32) ?*T {
            if (slot >= capacity) return null;
            return table.slots[slot].load(.acquire);
        }

        /// Clears a slot after its engine thread has fully stopped.
        pub fn retire(table: *Self, handle: Handle) void {
            if (handle.slot >= capacity) return;
            if (table.generations[handle.slot].load(.acquire) != handle.generation) return;
            table.envs[handle.slot].store(null, .release);
            table.slots[handle.slot].store(null, .release);
            _ = table.claimed.fetchAnd(~(@as(u32, 1) << @intCast(handle.slot)), .acq_rel);
        }
    };
}
