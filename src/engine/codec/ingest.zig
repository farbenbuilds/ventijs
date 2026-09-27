//! The read-only side of the boundary: a caller's bytes in, events queued.
//!
//! The codec unmasks a frame in place, because that saves a copy of every byte a
//! client sends and the engine's own `WebSocket.on_data` does the same over the
//! same `zslay` primitives. That is fine when the caller owns a mutable buffer. It
//! is not the case on the JavaScript side: Node-API cannot hand Zig a mutable
//! slice at all, and a `Buffer` the application may still be holding must not be
//! modified by a decoder underneath it.
//!
//! So the copy happens here, once per piece of `ingest_scratch` rather than once
//! per frame, and each piece is then unmasked in place inside the codec where the
//! saving actually is.

const capacities = @import("capacities.zig");
const result = @import("feed_result.zig");

/// Folds an input the caller must not see modified.
pub fn ingest(comptime Codec: type, peer: *Codec, input: []const u8) result.FeedResult {
    // On the stack rather than in the codec: the buffer is live only for this call,
    // and a per-codec one would cost its whole size on every live connection to
    // hold it for a few microseconds at a time.
    var scratch: [capacities.ingest_scratch]u8 = undefined;
    var offset: usize = 0;
    while (offset < input.len) {
        const count = @min(input.len - offset, scratch.len);
        @memcpy(scratch[0..count], input[offset..][0..count]);
        const step = peer.feed(scratch[0..count]);
        offset += step.consumed;
        if (step.outcome != .ok) return .{ .consumed = offset, .outcome = step.outcome };
        // A piece that was not fully taken means the queue filled, which is
        // backpressure rather than a stall: the caller drains and feeds the
        // remainder.
        if (step.consumed != count) return .{ .consumed = offset, .outcome = .backpressure };
    }
    return .{ .consumed = offset, .outcome = .ok };
}
