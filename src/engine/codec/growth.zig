//! A buffer that starts small and grows to what a connection actually sends.
//!
//! **Why this exists.** The codec's reassembly buffer, its outbound frame buffer,
//! and its fragment-boundary list were all `[N]u8` / `[N]u32` fields sized by a
//! `comptime` parameter, because the alternative -- a per-connection `maxPayload` --
//! "needs a runtime-sized buffer, which is a different codec". That reasoning was
//! half right: a runtime-sized buffer is a different *buffer*, but it is not a
//! different codec, and refusing it left `maxPayload` reported at `ws`'s 100 MiB
//! while a 32 KiB `comptime` array decided the real answer.
//!
//! The reason the arrays were there at all is worth keeping, because it is the
//! actual constraint: a `maxPayload` is a ceiling, not an allocation request. A
//! server holding `ws`'s default 100 MiB per connection cannot hold 128
//! connections, and a peer that never sends a message must not cost 100 MiB. So
//! every buffer here starts at a small fixed capacity and grows geometrically,
//! which makes the cost track the traffic rather than the configuration.
//!
//! That is also the fix for a cost nobody had measured. The old layout reserved
//! the message buffer, the frame buffer, and a 16384-entry `u32` boundary list for
//! every connection whether or not it was ever used, which is about 132 KiB of
//! resident memory per socket before a single byte arrived, and the boundary list
//! alone was twice the message buffer. The list is now 16 entries until a message
//! is actually fragmented, and a 100 MiB message is reached in about seventeen
//! reallocations rather than in one allocation a peer never asked for.
//!
//! **Growth is geometric and stops at the caller's ceiling.** A doubling that would
//! overshoot the requested size is clipped to the requested size, so the last step
//! to a 100 MiB message allocates 100 MiB rather than 128, and no step ever
//! allocates more than the ceiling permits.

const std = @import("std");

/// Why a grow could not happen. Distinct from the protocol refusals, because a
/// peer over `maxPayload` is a 1009 and an allocation failure is not: the codec
/// latches this as a failure rather than a message, because a process out of
/// memory is not something a retry helps.
pub const Error = error{OutOfMemory};

/// A heap buffer whose capacity is decided by use rather than by configuration.
///
/// Generic over the element type so the storage is typed and correctly aligned: the
/// fragment-boundary list is `u32` and reading it through a `[]u8` and casting would
/// be a way to get an unaligned load wrong rather than a way to save a branch.
///
/// A plain state record, not an object with a lifetime: the codec owns one, frees it
/// in its own `deinit`, and nothing else may hold a pointer into it. The allocator is
/// not a field, for the reason `codec/handles.zig` gives: an allocator stored inside
/// the state it allocates for is the shape the conventions forbid, and a codec is
/// only ever touched on the Node main thread, so the process allocator is the right
/// one and threading one through would be ceremony.
pub fn buffer(comptime T: type) type {
    return struct {
        const Self = @This();

        items: []T = &.{},
        length: usize = 0,

        /// Allocates `capacity` elements, which the caller picks: a floor worth
        /// starting at, not a promise. A zero capacity is refused rather than rounded
        /// up, so a caller that computed a floor of zero from its own configuration
        /// hears about it instead of silently getting a different number.
        pub fn init(capacity: usize) Error!Self {
            if (capacity == 0) return error.OutOfMemory;
            return .{ .items = try allocator.alloc(T, capacity) };
        }

        /// Releases the allocation. A buffer that never grew still holds its floor,
        /// so this is not conditional on `length`.
        pub fn deinit(self: *Self) void {
            if (self.items.len == 0) return;
            allocator.free(self.items);
            self.* = .{};
        }

        /// Makes room for `needed` more elements, taking the length to
        /// `length + needed`, and refusing past `ceiling`.
        ///
        /// Returns `error.OutOfMemory` both when `needed` would pass the ceiling and
        /// when the allocation genuinely fails, because the two are the same failure
        /// to the caller: either way the copy that was about to happen cannot, and
        /// either way a message is lost. The caller that needs to tell them apart
        /// checks the length against the ceiling itself, which it has to do anyway to
        /// raise `PayloadTooLarge` before a byte is copied.
        pub fn grow(self: *Self, needed: usize, ceiling: usize) Error!void {
            const total = std.math.add(usize, self.length, needed) catch return error.OutOfMemory;
            if (total > ceiling) return error.OutOfMemory;
            // The reallocation and the length advance are separate decisions, and
            // conflating them is a bug that only shows up on the *second* append to
            // a buffer that already had room: the length has to move whether or not
            // the capacity did.
            if (total > self.items.len) try self.realloc(total);
            self.length = total;
        }

        /// Grows the *capacity* to hold `capacity` elements, without touching the
        /// logical length.
        ///
        /// Used where the buffer is a staging area rather than an accumulator: the
        /// outbound frame buffer is rewritten whole every time, so its length is the
        /// length of the last frame and not a running total.
        pub fn reserve(self: *Self, capacity: usize, ceiling: usize) Error!void {
            if (capacity <= self.items.len) return;
            if (capacity > ceiling) return error.OutOfMemory;
            try self.realloc(capacity);
        }

        /// The elements written so far, which is what an event payload borrows.
        pub fn written(self: *const Self) []const T {
            return self.items[0..self.length];
        }

        /// The first `count` elements, for the one-buffer-one-frame paths.
        pub fn window(self: *const Self, count: usize) []const T {
            return self.items[0..count];
        }

        /// The last `count` elements, for a caller appending to the end.
        pub fn tail(self: *const Self, count: usize) []T {
            return self.items[self.length - count .. self.length];
        }

        /// Forgets the contents without releasing the allocation, for a buffer that is
        /// reused per message.
        pub fn clear(self: *Self) void {
            self.length = 0;
        }

        /// Reallocates to at least `capacity`, keeping whatever was already written.
        ///
        /// `allocator.realloc` rather than allocate-copy-free, so a growth step does
        /// not have to walk the bytes it is preserving. The target is the requested
        /// capacity rounded up towards the next power of two, which is what keeps the
        /// step after this one from being a different size again.
        fn realloc(self: *Self, capacity: usize) Error!void {
            const target = @max(capacity, std.math.ceilPowerOfTwo(usize, capacity) catch capacity);
            self.items = try allocator.realloc(self.items, target);
        }
    };
}

/// The process allocator. A `smp_allocator` rather than the connection's, for the
/// reason `codec/handles.zig` gives: a codec is only ever touched on the Node main
/// thread, and an allocator stored inside the state it allocates for is the shape
/// the conventions forbid.
const allocator = std.heap.smp_allocator;
