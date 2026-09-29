//! Engine-to-JavaScript transport: the only bridge an engine thread may use to
//! reach JavaScript. Events travel through one threadsafe function and are
//! rendered on the Node main thread by `dispatch.call_js`; nothing allocates
//! on the engine thread.

const std = @import("std");
const napi = @import("napi-zig");
const dispatch = @import("dispatch.zig");
const events = @import("events.zig");
const sizing = @import("sizing.zig");

const c = napi.c;

pub const Event = events.Event;

/// Slots held back for terminal events: one close per connection plus the pair.
pub const terminal_reserve = sizing.terminal_reserve;

/// Slots only shutdown events may claim.
pub const shutdown_reserve = sizing.shutdown_reserve;

/// Ring depth rounded to the power of two the mask needs (comptime sum 288).
pub const capacity = sizing.capacity;

const Ring = sizing.Ring;

/// Reserve tier an event belongs to. Terminal and shutdown events are
/// reachable only through their emit functions, so a regular flood can never
/// consume their slots.
const Tier = enum { regular, terminal, shutdown };

/// Bounded bridge between one engine thread and the Node main thread.
pub const Channel = struct {
    tsfn: ?c.napi_threadsafe_function = null,
    /// Latched when the tsfn is gone or closing, so no later call touches it.
    closing: std.atomic.Value(bool) = .init(false),
    ring: Ring = .{},

    /// Creates the threadsafe function. Runs on the Node main thread. The
    /// context is the ring, not the channel: dispatch only needs the ring and
    /// the channel may be freed by the handler the dispatch invokes.
    pub fn open(channel: *Channel, env: napi.Env, dispatch_fn: napi.Callback) !void {
        const name = try env.createString("ventiws.server");
        var out: c.napi_threadsafe_function = undefined;
        const status = c.napi_create_threadsafe_function(
            env.handle,
            dispatch_fn.val.handle,
            null,
            name.handle,
            0,
            1,
            null,
            null,
            &channel.ring,
            dispatch.call_js,
            &out,
        );
        if (status != .ok) return error.ThreadsafeFunctionUnavailable;
        channel.tsfn = out;
    }

    /// Acquires the channel. A refused acquire latches it and reports false,
    /// so the caller must not release.
    pub fn acquire(channel: *Channel) bool {
        const tsfn = channel.tsfn orelse return false;
        if (c.napi_acquire_threadsafe_function(tsfn) != .ok) {
            channel.closing.store(true, .release);
            return false;
        }
        return true;
    }

    /// Stops the channel so a thread about to be joined cannot queue again.
    pub fn stop(channel: *Channel) void {
        channel.closing.store(true, .release);
    }

    /// Releases the engine thread's acquisition; only call after `acquire`.
    pub fn release(channel: *Channel) void {
        const tsfn = channel.tsfn orelse return;
        _ = c.napi_release_threadsafe_function(tsfn, .release);
    }

    /// Releases the creating thread's reference after the engine thread stops.
    pub fn close(channel: *Channel) void {
        const tsfn = channel.tsfn orelse return;
        channel.tsfn = null;
        channel.closing.store(true, .release);
        _ = c.napi_release_threadsafe_function(tsfn, .release);
    }

    /// Queues one regular event; a full ring drops it and returns false.
    pub fn emit(channel: *Channel, event: Event) bool {
        return channel.publish(event, .regular);
    }

    /// Queues one connection-close event, which may use the close tail but
    /// never the shutdown pair.
    pub fn emit_terminal(channel: *Channel, event: Event) bool {
        return channel.publish(event, .terminal);
    }

    /// Queues one shutdown event (`server_closed` or `engine_error`), the only
    /// tier allowed to claim the last two slots.
    pub fn emit_shutdown(channel: *Channel, event: Event) bool {
        return channel.publish(event, .shutdown);
    }

    fn publish(channel: *Channel, event: Event, tier: Tier) bool {
        if (channel.closing.load(.acquire)) return false;
        const tsfn = channel.tsfn orelse return false;
        const claimed = switch (tier) {
            .regular => channel.ring.reserve(),
            .terminal => channel.ring.reserve_terminal(),
            .shutdown => channel.ring.reserve_shutdown(),
        } orelse return false;
        const slot = channel.ring.slot(claimed);
        slot.event = event;
        slot.sequence = claimed;
        if (c.napi_call_threadsafe_function(tsfn, slot, .non_blocking) != .ok) {
            channel.ring.drop(claimed);
            channel.closing.store(true, .release);
            return false;
        }
        return true;
    }

    /// Reserved events not dispatched yet.
    pub fn pending(channel: *Channel) u64 {
        return channel.ring.pending();
    }

    /// Events reserved but never queued for dispatch.
    pub fn dropped(channel: *Channel) u64 {
        return channel.ring.dropped_count();
    }
};
