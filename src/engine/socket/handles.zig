//! Generation-checked connection slots. State and generation share one atomic word,
//! so a resolve can never pair a fresh generation with a stale state or observe a torn
//! transition: a stale JavaScript call is a typed error, never a use-after-free.

const std = @import("std");

pub const State = enum(u8) { free, active };

/// Opaque connection handle: 32-bit slot index and 32-bit generation. The integer form
/// is the only representation passed to JavaScript.
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

const Slot = struct {
    /// `generation << 8 | state`; one word keeps the pair consistent for a
    /// lock-free `resolve`.
    word: std.atomic.Value(u64) = .init(0),

    fn pack(state: State, generation: u32) u64 {
        return (@as(u64, generation) << 8) | @intFromEnum(state);
    }

    /// Reconstructs the state from the low byte rather than `@enumFromInt`, with
    /// `else => unreachable` because `pack` is the only writer of that byte and writes
    /// one of the two. A defaulting third state would turn a second writer into a
    /// silently free slot, and every transition would then report a stale handle as
    /// `invalid_handle` instead of failing where the bug is.
    fn state_of(word: u64) State {
        return switch (@as(u8, @truncate(word))) {
            0 => .free,
            1 => .active,
            else => unreachable,
        };
    }

    fn generation_of(word: u64) u32 {
        return @truncate(word >> 8);
    }
};

/// A fixed-capacity slab; `capacity` must match the engine pool so every pool slot has
/// exactly one slab slot.
pub fn connection_slab(comptime capacity: u32) type {
    if (capacity == 0) @compileError("connection slab capacity must be greater than zero");

    return struct {
        const Self = @This();

        slots: [capacity]Slot = [_]Slot{.{}} ** capacity,
        /// Live connections. Atomic because it is the `max_connections` admission gate,
        /// where a torn or reordered count is an admission bug that stays invisible
        /// until a server is under load.
        active: std.atomic.Value(u32) = .init(0),

        /// Marks a pool slot active and returns a fresh handle. The generation advances
        /// on acquire, so the previous occupant's handle can never resolve again; the CAS
        /// loop terminates because a failed swap reloads the word and every success moves
        /// the slot from free to active.
        pub fn acquire(slab: *Self, index: u32) !Handle {
            if (index >= capacity) return error.SlotOutOfRange;
            const slot = &slab.slots[index];
            while (true) {
                const word = slot.word.load(.acquire);
                if (Slot.state_of(word) != .free) return error.SlotBusy;
                const generation = Slot.generation_of(word) +% 1;
                if (slot.word.cmpxchgWeak(word, Slot.pack(.active, generation), .acq_rel, .acquire) == null) {
                    _ = slab.active.fetchAdd(1, .acq_rel);
                    return .{ .index = index, .generation = generation };
                }
            }
        }

        /// Frees a pool slot and returns the handle that was live for it.
        pub fn release(slab: *Self, index: u32) ?Handle {
            if (index >= capacity) return null;
            const slot = &slab.slots[index];
            while (true) {
                const word = slot.word.load(.acquire);
                const generation = Slot.generation_of(word);
                if (Slot.state_of(word) != .active) return null;
                if (slot.word.cmpxchgWeak(word, Slot.pack(.free, generation), .acq_rel, .acquire) == null) {
                    _ = slab.active.fetchSub(1, .acq_rel);
                    return .{ .index = index, .generation = generation };
                }
            }
        }

        /// A handle's slot index, or null when it is out of range, the slot is free, or
        /// the generation is stale. One acquire load answers both checks, so the caller
        /// can trust the generation for the rest of its operation.
        pub fn resolve(slab: *const Self, handle: Handle) ?u32 {
            if (handle.index >= capacity) return null;
            const word = slab.slots[handle.index].word.load(.acquire);
            if (Slot.state_of(word) != .active) return null;
            if (Slot.generation_of(word) != handle.generation) return null;
            return handle.index;
        }

        /// The generation occupying a slot, or null when it is free or out of range. The
        /// engine thread needs it to stamp an inbound payload: only the main thread holds
        /// a handle, so there is nothing to resolve against.
        pub fn generation_at(slab: *const Self, index: u32) ?u32 {
            if (index >= capacity) return null;
            const word = slab.slots[index].word.load(.acquire);
            if (Slot.state_of(word) != .active) return null;
            return Slot.generation_of(word);
        }

        pub fn count_active(slab: *const Self) u32 {
            return slab.active.load(.acquire);
        }
    };
}
