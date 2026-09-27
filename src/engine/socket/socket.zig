//! Per-connection records and the exactly-once terminal latch.
//!
//! The socket slab mirrors the connection slab: one record per engine pool slot,
//! indexed by the same slot index the handle names. `send`, `close`,
//! `pause_dispatch`, and `resume_dispatch` are explicit transitions over that
//! record (see `socket_ops.zig`), and the record owns the bounded payload ring
//! those operations stage into. A per-slot lock serializes the engine thread's
//! open/finish against the Node main thread's operations, and the terminal latch
//! flips once per generation.

const std = @import("std");
const payload = @import("payload.zig");
const status = @import("status.zig");
const ops = @import("socket_ops.zig");

pub const State = status.State;
pub const Status = status.Status;
pub const valid_close_code = status.valid_close_code;

/// Fixed-capacity connection records. `PayloadRing` is the bounded staging
/// ring every record shares; its slot capacity is the payload cap.
pub fn socket_slab(
    comptime capacity: u32,
    comptime PayloadRing: type,
    comptime InboundRing: type,
) type {
    if (capacity == 0) @compileError("socket slab capacity must be greater than zero");

    return struct {
        const Self = @This();

        pub const Slot = ops.Slot;

        /// Staged outbound payloads, consumed by the engine thread through
        /// `queues.take_outbound`.
        ring: PayloadRing = .{},
        /// Parsed inbound messages waiting for the Node main thread, filled by
        /// the engine thread through `queues.stage_inbound`. See
        /// `instance.inbound_slots` for why this is deeper than `ring`.
        inbound: InboundRing = .{},
        slots: [capacity]Slot = [_]Slot{.{}} ** capacity,

        /// Resets a record for a freshly acquired connection generation.
        pub fn open(slab: *Self, index: u32, generation: u32) void {
            const slot = slab.slot_at(index) orelse return;
            slot.lock();
            defer slot.unlock();
            slot.generation = generation;
            slot.state.store(.open, .release);
            slot.terminal.store(false, .release);
            slot.buffered.store(0, .release);
            slot.paused.store(false, .release);
        }

        /// Validates and stages one outbound text or binary message.
        pub fn send(slab: *Self, index: u32, generation: u32, kind: payload.Kind, data: []const u8) Status {
            const slot = slab.slot_at(index) orelse return .invalid_handle;
            slot.lock();
            defer slot.unlock();
            return ops.send(slot, &slab.ring, index, generation, kind, data);
        }

        /// Validates a close code and reason, stages the close frame, and
        /// enters `closing`. A second close observes `closing`.
        pub fn close(slab: *Self, index: u32, generation: u32, code: u16, reason: []const u8) Status {
            const slot = slab.slot_at(index) orelse return .invalid_handle;
            slot.lock();
            defer slot.unlock();
            return ops.close(slot, &slab.ring, index, generation, code, reason);
        }

        /// Suspends inbound message dispatch. Idempotent while open.
        pub fn pause_dispatch(slab: *Self, index: u32, generation: u32) Status {
            return slab.set_paused(index, generation, true);
        }

        /// Resumes inbound message dispatch. `resume` is a Zig keyword, so the
        /// transition is named for what it resumes.
        pub fn resume_dispatch(slab: *Self, index: u32, generation: u32) Status {
            return slab.set_paused(index, generation, false);
        }

        fn set_paused(slab: *Self, index: u32, generation: u32, paused: bool) Status {
            const slot = slab.slot_at(index) orelse return .invalid_handle;
            slot.lock();
            defer slot.unlock();
            return ops.set_paused(slot, generation, paused);
        }

        /// Latches the terminal transition and marks the slot closed. The winning
        /// caller owns the single close emission and slab release.
        ///
        /// The only terminal latch. There used to be a second, lock-free form that
        /// flipped the same word without setting the state; nothing in the addon
        /// called it, so one of two latches was reachable only from a test.
        pub fn finish(slab: *Self, index: u32) bool {
            const slot = slab.slot_at(index) orelse return false;
            slot.lock();
            defer slot.unlock();
            if (slot.terminal.cmpxchgStrong(false, true, .acq_rel, .acquire) != null) return false;
            slot.state.store(.closed, .release);
            return true;
        }

        /// Accounts bytes the engine thread drained from the staging ring. The
        /// drain is the single caller; the lock keeps the saturation check atomic.
        ///
        /// The generation is re-checked under the lock like every other transition:
        /// a payload released after its slot was recycled would otherwise debit
        /// the new occupant's `bufferedAmount`.
        pub fn note_drained(slab: *Self, index: u32, generation: u32, drained: u32) void {
            const slot = slab.slot_at(index) orelse return;
            slot.lock();
            defer slot.unlock();
            if (slot.generation != generation) return;
            const current = slot.buffered.load(.acquire);
            slot.buffered.store(current - @min(drained, current), .release);
        }

        /// Bytes staged for a live generation. The generation is re-checked
        /// under the record lock, so a recycled slot never reports the new
        /// connection's count to a stale handle.
        pub fn buffered(slab: *Self, index: u32, generation: u32) u32 {
            const slot = slab.slot_at(index) orelse return 0;
            slot.lock();
            defer slot.unlock();
            if (slot.generation != generation) return 0;
            return slot.buffered.load(.acquire);
        }

        /// The one transition without a generation check: the engine thread has
        /// no handle, and this arrives from the connection's own callback, so the
        /// index is its pool slot. `open` resets the flag per generation.
        pub fn is_paused(slab: *const Self, index: u32) bool {
            if (index >= capacity) return false;
            return slab.slots[index].paused.load(.acquire);
        }

        pub fn state_of(slab: *const Self, index: u32) ?State {
            if (index >= capacity) return null;
            return slab.slots[index].state.load(.acquire);
        }

        fn slot_at(slab: *Self, index: u32) ?*Slot {
            if (index >= capacity) return null;
            return &slab.slots[index];
        }
    };
}
