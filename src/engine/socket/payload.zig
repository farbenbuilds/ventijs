//! Bounded outbound payload staging. JavaScript bytes are copied into engine-owned
//! slots before a staging call returns and only scalar record fields travel back out,
//! so a JavaScript pointer is never retained and an engine pointer never escapes.

const std = @import("std");

/// Payload category; the engine drain maps these onto the zslay opcodes.
pub const Kind = enum(u8) { text, binary, ping, pong, close };

/// Failure of `stage`; both cases become statuses at the boundary, and neither
/// allocates.
pub const Error = error{ PayloadTooLarge, QueueFull };

/// One staged payload. `bytes` borrows ring storage, is valid until `release`,
/// and must never cross back to JavaScript.
pub const View = struct {
    kind: Kind,
    index: u32,
    generation: u32,
    bytes: []const u8,
    sequence: u64,
};

/// A fixed-capacity structure-of-arrays ring. Slot ownership transfers through the
/// sequence word, so a producer never observes a partially written record.
pub fn payload_ring(comptime slots: usize, comptime slot_bytes: usize) type {
    if (slots == 0) @compileError("payload ring needs at least one slot");
    if (!std.math.isPowerOfTwo(slots)) @compileError("payload ring slot count must be a power of two");
    if (slot_bytes == 0) @compileError("payload slot capacity must be greater than zero");
    if (slot_bytes > std.math.maxInt(u32)) @compileError("payload slot capacity must fit a u32 length");

    return struct {
        const Self = @This();
        const cache_line = std.atomic.cache_line;

        pub const slot_capacity = slot_bytes;

        bytes: [slots][slot_bytes]u8 = undefined,
        kinds: [slots]Kind = .{.text} ** slots,
        indices: [slots]u32 = .{0} ** slots,
        generations: [slots]u32 = .{0} ** slots,
        lengths: [slots]u32 = .{0} ** slots,
        sequences: [slots]std.atomic.Value(usize) align(std.atomic.cache_line) = initial_sequences(),
        dropped: std.atomic.Value(u64) = .init(0),
        enqueue_pos: std.atomic.Value(usize) align(cache_line) = .init(0),
        dequeue_pos: std.atomic.Value(usize) align(cache_line) = .init(0),

        fn initial_sequences() [slots]std.atomic.Value(usize) {
            var out: [slots]std.atomic.Value(usize) = undefined;
            for (&out, 0..) |*sequence, index| sequence.* = .init(index);
            return out;
        }

        /// Copies `data` into the next free slot. The source is read only for this
        /// call and the record is published with a release store, so the consumer
        /// sees it whole. The CAS loop terminates because a failed swap reloads the
        /// producer position and a success either returns `QueueFull` or claims the
        /// sequence.
        pub fn stage(
            ring: *Self,
            kind: Kind,
            index: u32,
            generation: u32,
            data: []const u8,
        ) Error!void {
            if (data.len > slot_bytes) return error.PayloadTooLarge;
            var pos = ring.enqueue_pos.load(.monotonic);
            while (true) {
                const cell = &ring.sequences[pos % slots];
                const sequence = cell.load(.acquire);
                const difference = @as(isize, @bitCast(sequence -% pos));
                if (difference == 0) {
                    if (ring.enqueue_pos.cmpxchgWeak(pos, pos +% 1, .monotonic, .monotonic)) |actual| {
                        pos = actual;
                        continue;
                    }
                    const slot = pos % slots;
                    @memcpy(ring.bytes[slot][0..data.len], data);
                    ring.kinds[slot] = kind;
                    ring.indices[slot] = index;
                    ring.generations[slot] = generation;
                    ring.lengths[slot] = @intCast(data.len);
                    cell.store(pos +% 1, .release);
                    return;
                }
                if (difference < 0) {
                    _ = ring.dropped.fetchAdd(1, .monotonic);
                    return error.QueueFull;
                }
                pos = ring.enqueue_pos.load(.monotonic);
            }
        }

        /// The oldest staged payload without consuming it, or null when the ring is
        /// empty. Engine thread only; pair with `release`.
        pub fn peek(ring: *Self) ?View {
            const pos = ring.dequeue_pos.load(.monotonic);
            const sequence = ring.sequences[pos % slots].load(.acquire);
            const difference = @as(isize, @bitCast(sequence -% (pos +% 1)));
            if (difference < 0) return null;
            const slot = pos % slots;
            // The stored length is the only thing deciding how much of a fixed-size
            // slot is read, so it is clamped here rather than trusted from the
            // producer's earlier check: one `min` on a cold path buys a slice that
            // is in bounds by construction, which is what a release build needs.
            const stored = ring.lengths[slot];
            const length: usize = @min(@as(usize, stored), slot_bytes);
            return .{
                .kind = ring.kinds[slot],
                .index = ring.indices[slot],
                .generation = ring.generations[slot],
                .bytes = ring.bytes[slot][0..length],
                .sequence = pos,
            };
        }

        /// Consumes a view returned by `peek` and frees its slot.
        pub fn release(ring: *Self, view: View) void {
            ring.sequences[view.sequence % slots].store(view.sequence +% slots, .release);
            ring.dequeue_pos.store(view.sequence +% 1, .release);
        }

        /// Staged payloads that have not been released yet.
        pub fn pending(ring: *const Self) usize {
            const enqueued = ring.enqueue_pos.load(.acquire);
            const dequeued = ring.dequeue_pos.load(.acquire);
            return enqueued -% dequeued;
        }

        /// Stages rejected because the ring was full; the other source of a
        /// non-zero drop count is `queues.count_dropped`.
        pub fn dropped_count(ring: *const Self) u64 {
            return ring.dropped.load(.acquire);
        }
    };
}
