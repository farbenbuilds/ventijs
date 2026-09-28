//! Compile-time sizing for the engine event channel. The depth and its reserve tiers derive
//! from the compiled connection capacity, so both planes share one ring type.

const std = @import("std");
const options = @import("../server/options.zig");
const ring_module = @import("ring.zig");

/// Slots held back from regular events: one connection-close per connection plus the shutdown pair.
pub const terminal_reserve: usize = options.connection_capacity + shutdown_reserve;

/// Slots reachable only by `server_closed` and `engine_error`, so shutdown cannot be lost to a
/// flood of close events.
pub const shutdown_reserve: usize = 2;

/// Ring depth rounded to the power of two the mask needs (comptime sum 288).
pub const capacity: usize = std.math.ceilPowerOfTwo(
    usize,
    2 * options.connection_capacity + 32,
) catch unreachable;

pub const Ring = ring_module.event_ring(capacity, terminal_reserve, shutdown_reserve);
