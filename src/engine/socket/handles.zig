//! Generation-checked connection slots and the opaque handles that name them.
//!
//! One slab is allocated per server beside the engine connection pool. A slot
//! index maps one-to-one onto an engine pool slot; the generation rejects a
//! handle after its connection has closed, so a stale JavaScript call is a
//! typed error instead of a use-after-free. State and generation share one
//! atomic word, so a resolve can never pair a fresh generation with a stale
//! state or observe a torn transition.

const std = @import("std");

/// Lifecycle of one connection slot.
pub const State = enum(u8) { free, active };

/// Opaque connection handle: 32 bit slot index and 32 bit generation.
///
/// The integer form is the only representation passed to JavaScript.
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
    /// `generation << 8 | state`. One atomic word keeps the pair consistent
    /// for the Node main thread's lock-free `resolve`.
    word: std.atomic.Value(u64) = .init(0),

    fn pack(state: State, generation: u32) u64 {
        return (@as(u64, generation) << 8) | @intFromEnum(state);
    }

    fn state_of(word: u64) State {
        return @enumFromInt(@as(u8, @truncate(word)));
    }

    fn generation_of(word: u64) u32 {
        return @truncate(word >> 8);
    }
};

/// Builds a fixed-capacity connection slab. `capacity` must match the engine
/// pool capacity so every pool slot has exactly one slab slot.
pub fn connection_slab(comptime capacity: u32) type {
    if (capacity == 0) @compileError("connection slab capacity must be greater than zero");

    return struct {
        const Self = @This();

        slots: [capacity]Slot = [_]Slot{.{}} ** capacity,
        active: u32 = 0,

        /// Marks a pool slot active and returns a fresh handle for it.
        ///
        /// The generation advances on acquire, so a handle from the previous
        /// occupant of this slot can never resolve again. The CAS loop
        /// terminates because a failed swap reloads the word and every success
        /// moves the slot from free to active.
        pub fn acquire(slab: *Self, index: u32) !Handle {
            if (index >= capacity) return error.SlotOutOfRange;
            const slot = &slab.slots[index];
            while (true) {
                const word = slot.word.load(.acquire);
                if (Slot.state_of(word) != .free) return error.SlotBusy;
                const generation = Slot.generation_of(word) +% 1;
                if (slot.word.cmpxchgWeak(word, Slot.pack(.active, generation), .acq_rel, .acquire) == null) {
                    slab.active += 1;
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
                    slab.active -= 1;
                    return .{ .index = index, .generation = generation };
                }
            }
        }

        /// Resolves a handle to its slot index, or null when the handle is
        /// out of range, the slot is free, or the generation is stale.
        ///
        /// A single acquire load answers both checks, so the caller can trust
        /// the generation it resolved against for the rest of its operation.
        pub fn resolve(slab: *const Self, handle: Handle) ?u32 {
            if (handle.index >= capacity) return null;
            const word = slab.slots[handle.index].word.load(.acquire);
            if (Slot.state_of(word) != .active) return null;
            if (Slot.generation_of(word) != handle.generation) return null;
            return handle.index;
        }

        /// The generation currently occupying a slot, or null when the slot is
        /// free or out of range. The engine thread needs it to stamp an inbound
        /// payload with the generation it belongs to: only the main thread holds
        /// a handle, so there is no handle to resolve against here.
        pub fn generation_at(slab: *const Self, index: u32) ?u32 {
            if (index >= capacity) return null;
            const word = slab.slots[index].word.load(.acquire);
            if (Slot.state_of(word) != .active) return null;
            return Slot.generation_of(word);
        }

        pub fn count_active(slab: *const Self) u32 {
            return slab.active;
        }
    };
}
