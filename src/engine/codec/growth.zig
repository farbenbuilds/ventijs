//! A buffer that starts small and grows to what a connection actually sends, because a
//! `maxPayload` is a ceiling and not an allocation request. Growth is geometric, clipped to it.

const std = @import("std");

/// Distinct from the protocol refusals: a peer over `maxPayload` is a 1009 and an allocation
/// failure is not, but no retry helps a process that is out of memory.
pub const Error = error{OutOfMemory};

/// Generic over the element type so the storage is typed and aligned: the boundary list is
/// `u32`, and reading it through a `[]u8` invites an unaligned load.
pub fn buffer(comptime T: type) type {
    return struct {
        const Self = @This();

        items: []T = &.{},
        length: usize = 0,

        /// Allocates `capacity` elements, a floor and not a promise. Zero is refused, not rounded up.
        pub fn init(capacity: usize) Error!Self {
            if (capacity == 0) return error.OutOfMemory;
            return .{ .items = try allocator.alloc(T, capacity) };
        }

        /// Releases the allocation; a buffer that never grew still holds its floor.
        pub fn deinit(self: *Self) void {
            if (self.items.len == 0) return;
            allocator.free(self.items);
            self.* = .{};
        }

        /// A ceiling refusal and a failed allocation are both `OutOfMemory` because the copy
        /// cannot happen either way; a caller that must tell them apart compares to the ceiling first.
        pub fn grow(self: *Self, needed: usize, ceiling: usize) Error!void {
            const total = std.math.add(usize, self.length, needed) catch return error.OutOfMemory;
            if (total > ceiling) return error.OutOfMemory;
            // The reallocation and the length advance are separate decisions: the length has
            // to move whether or not the capacity did, which shows up only on a second append.
            if (total > self.items.len) try self.realloc(total);
            self.length = total;
        }

        /// Grows the *capacity* without the logical length, for a staging area: the outbound
        /// frame buffer is rewritten whole, so its length is the last frame's, not a running total.
        pub fn reserve(self: *Self, capacity: usize, ceiling: usize) Error!void {
            if (capacity <= self.items.len) return;
            if (capacity > ceiling) return error.OutOfMemory;
            try self.realloc(capacity);
        }

        pub fn written(self: *const Self) []const T {
            return self.items[0..self.length];
        }

        pub fn window(self: *const Self, count: usize) []const T {
            return self.items[0..count];
        }

        pub fn tail(self: *const Self, count: usize) []T {
            return self.items[self.length - count .. self.length];
        }

        pub fn clear(self: *Self) void {
            self.length = 0;
        }

        /// Reallocates keeping what was written. `realloc` rather than allocate-copy-free, so
        /// a growth step does not walk the bytes it preserves; the target rounds to a power of two.
        fn realloc(self: *Self, capacity: usize) Error!void {
            const target = @max(capacity, std.math.ceilPowerOfTwo(usize, capacity) catch capacity);
            self.items = try allocator.realloc(self.items, target);
        }
    };
}

/// The process allocator: a codec is only touched on the Node main thread, and an allocator
/// stored inside the state it allocates for is the shape the conventions forbid.
const allocator = std.heap.smp_allocator;
