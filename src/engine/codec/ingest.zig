//! The read-only side of the boundary: a caller's bytes in, events queued. The codec unmasks
//! in place, which needs a mutable buffer the caller owns and the Node-API ABI cannot provide,
//! so the copy happens here, once per `ingest_scratch` piece rather than once per frame.

const capacities = @import("capacities.zig");
const result = @import("feed_result.zig");

pub fn ingest(comptime Codec: type, peer: *Codec, input: []const u8) result.FeedResult {
    // On the stack rather than in the codec: the buffer is live only for this call.
    var scratch: [capacities.ingest_scratch]u8 = undefined;
    var offset: usize = 0;
    while (offset < input.len) {
        const count = @min(input.len - offset, scratch.len);
        @memcpy(scratch[0..count], input[offset..][0..count]);
        const step = peer.feed(scratch[0..count]);
        offset += step.consumed;
        if (step.outcome != .ok) return .{ .consumed = offset, .outcome = step.outcome };
        // A piece not fully taken means the queue filled, which is backpressure, not a stall.
        if (step.consumed != count) return .{ .consumed = offset, .outcome = .backpressure };
    }
    return .{ .consumed = offset, .outcome = .ok };
}
