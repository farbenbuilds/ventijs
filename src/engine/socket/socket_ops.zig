//! Outbound transitions over one socket record. Every function assumes the caller holds
//! the record's lock and has checked the generation; each staged payload carries that
//! generation, so a drain can drop a record whose connection was recycled in flight.

const std = @import("std");
const payload = @import("payload.zig");
const status = @import("status.zig");

/// One connection record. The lock serializes the engine thread's reset and close
/// against the main thread's transitions here, so every field is safe to touch
/// while held.
pub const Slot = struct {
    state: std.atomic.Value(status.State) = .init(.open),
    terminal: std.atomic.Value(bool) = .init(false),
    buffered: std.atomic.Value(u32) = .init(0),
    paused: std.atomic.Value(bool) = .init(false),
    locked: std.atomic.Value(bool) = .init(false),
    generation: u32 = 0,

    /// Spins only while the engine thread resets or closes the record or the
    /// main thread copies a bounded payload; both are short.
    pub fn lock(slot: *Slot) void {
        while (slot.locked.cmpxchgWeak(false, true, .acquire, .monotonic) != null) {
            std.atomic.spinLoopHint();
        }
    }

    pub fn unlock(slot: *Slot) void {
        slot.locked.store(false, .release);
    }

    /// Returns the blocking status when the record is not open.
    pub fn blocked_status(slot: *Slot) ?status.Status {
        return switch (slot.state.load(.acquire)) {
            .open => null,
            .closing => .closing,
            .closed => .closed,
        };
    }
};

/// Validates and stages one outbound text or binary message.
pub fn send(slot: anytype, ring: anytype, index: u32, generation: u32, kind: payload.Kind, data: []const u8) status.Status {
    if (slot.generation != generation) return .invalid_handle;
    if (slot.blocked_status()) |blocked| return blocked;
    ring.stage(kind, index, generation, data) catch |err| return switch (err) {
        error.PayloadTooLarge => .payload_too_large,
        error.QueueFull => .backpressure,
    };
    _ = slot.buffered.fetchAdd(@intCast(data.len), .monotonic);
    return .ok;
}

/// Validates a close code and reason, then refuses with `policy_violation`: the engine
/// route cannot frame an app-initiated close until the engine-thread drain `AGENTS.md`
/// names as missing exists, and the outbound ring only publishes text and binary, so a
/// staged close record would report success for a frame nothing can deliver. The record
/// is left open, not latched.
pub fn close(slot: anytype, _: anytype, _: u32, generation: u32, code: u16, reason: []const u8) status.Status {
    if (slot.generation != generation) return .invalid_handle;
    if (slot.blocked_status()) |blocked| return blocked;
    if (!status.valid_close_code(code)) return .invalid_close_code;
    if (reason.len > status.max_close_reason_bytes) return .invalid_close_reason;
    if (!std.unicode.utf8ValidateSlice(reason)) return .invalid_close_reason;
    return .policy_violation;
}

/// Sets the inbound-dispatch pause flag for an open connection.
pub fn set_paused(slot: anytype, generation: u32, paused: bool) status.Status {
    if (slot.generation != generation) return .invalid_handle;
    if (slot.blocked_status()) |blocked| return blocked;
    slot.paused.store(paused, .release);
    return .ok;
}
