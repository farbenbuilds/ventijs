//! Bounded single-producer/consumer event ring. The engine thread reserves a sequence and
//! fills the slot; Node completes it after copying the event out. `reserved - completed`
//! bounds the outstanding events, so a stalled consumer drops events rather than growing
//! memory. Two reserve tails are held back in tiers, so a close or shutdown is never lost.

const std = @import("std");
const events = @import("events.zig");

const default_event = events.Event{ .kind = .listening, .server = 0 };

/// Fixed-capacity ring. `terminal_reserve` slots are held back from `reserve` for connection
/// closes, and `shutdown_reserve` inside that tail are reachable only via `reserve_shutdown`.
pub fn event_ring(
    comptime capacity: usize,
    comptime terminal_reserve: usize,
    comptime shutdown_reserve: usize,
) type {
    if (!std.math.isPowerOfTwo(capacity)) {
        @compileError("event ring capacity must be a power of two");
    }
    if (terminal_reserve >= capacity) {
        @compileError("terminal reserve must leave room for regular events");
    }
    if (shutdown_reserve > terminal_reserve) {
        @compileError("shutdown reserve must fit inside the terminal reserve");
    }

    return struct {
        const Self = @This();

        pub const Slot = struct {
            event: events.Event = default_event,
            sequence: u64 = 0,
        };

        /// Kept off the producer/consumer counters' cache lines.
        slots: [capacity]Slot align(std.atomic.cache_line) = [_]Slot{.{}} ** capacity,
        /// Producer-owned sequence counter.
        reserved: std.atomic.Value(u64) = .init(0),
        /// Events that could not be queued or dispatched.
        dropped: std.atomic.Value(u64) = .init(0),
        /// Reservations whose dispatch was never queued: counted against the limit, not `pending`.
        abandoned: std.atomic.Value(u64) = .init(0),
        /// Consumer-owned progress counter.
        completed: std.atomic.Value(u64) align(std.atomic.cache_line) = .init(0),

        /// The CAS loop terminates because `reserved - completed` grows by one on every swap
        /// and the caller stops at the limit.
        pub fn reserve(ring: *Self) ?u64 {
            return ring.claim(capacity - terminal_reserve);
        }

        /// Claims the next sequence for a close event: the first tail, never the shutdown pair.
        pub fn reserve_terminal(ring: *Self) ?u64 {
            return ring.claim(capacity - shutdown_reserve);
        }

        /// Claims the next sequence for a shutdown event, the only tier allowed the last slots.
        pub fn reserve_shutdown(ring: *Self) ?u64 {
            return ring.claim(capacity);
        }

        fn claim(ring: *Self, comptime limit: usize) ?u64 {
            while (true) {
                const reserved = ring.reserved.load(.acquire);
                const completed = ring.completed.load(.acquire);
                if (reserved -% completed >= limit) {
                    _ = ring.dropped.fetchAdd(1, .monotonic);
                    return null;
                }
                if (ring.reserved.cmpxchgWeak(reserved, reserved + 1, .acq_rel, .monotonic) == null) {
                    return reserved;
                }
            }
        }

        pub fn slot(ring: *Self, sequence: u64) *Slot {
            return &ring.slots[@intCast(sequence & (capacity - 1))];
        }

        /// `sequence + 1` is the highest contiguous completion because the consumer dispatches
        /// in order; the max keeps the counter monotonic if a drop was already counted.
        pub fn complete(ring: *Self, sequence: u64) void {
            _ = @atomicRmw(u64, &ring.completed.raw, .Max, sequence +% 1, .release);
        }

        /// `claim` still counts the slot against the limit so it is never reused under a live
        /// consumer, but `abandoned` keeps it out of `pending`, or a failed queue blocks finalize.
        pub fn drop(ring: *Self, sequence: u64) void {
            _ = sequence;
            _ = ring.dropped.fetchAdd(1, .monotonic);
            _ = ring.abandoned.fetchAdd(1, .monotonic);
        }

        /// Reserved events that are neither dispatched nor abandoned. The second
        /// subtraction saturates because a later completion can numerically overtake an
        /// abandoned reservation, and a wrapped count would strand `finalize` waiting
        /// forever. Clamping at zero is exact wherever a counter is reachable: the only
        /// drop path abandons the newest reservation and closes the channel to new ones.
        pub fn pending(ring: *Self) u64 {
            const outstanding = ring.reserved.load(.acquire) -% ring.completed.load(.acquire);
            return outstanding -| ring.abandoned.load(.acquire);
        }

        /// Events that were reserved but never queued for dispatch.
        pub fn dropped_count(ring: *Self) u64 {
            return ring.dropped.load(.acquire);
        }
    };
}
