//! Renders one queued engine event into JavaScript on the Node main thread.
//!
//! The threadsafe function's context is the ring, so this renderer never sees
//! the owning channel. Rendering uses a stack-buffer arena, so a dispatch
//! allocates nothing from the heap.

const std = @import("std");
const napi = @import("napi-zig");
const sizing = @import("sizing.zig");

const c = napi.c;

/// Renders one event into JavaScript and invokes the dispatch function. Node
/// drains a destroyed threadsafe function with a null environment, which
/// returns before touching the ring. The ring is not touched after the handler
/// runs because the handler may destroy the channel that owns it.
pub fn call_js(
    raw_env: c.napi_env,
    js_callback: c.napi_value,
    context: ?*anyopaque,
    data: ?*anyopaque,
) callconv(.c) void {
    if (@intFromPtr(raw_env) == 0 or @intFromPtr(js_callback) == 0) return;

    const slot: *sizing.Ring.Slot = @ptrCast(@alignCast(data orelse return));
    const ring: *sizing.Ring = @ptrCast(@alignCast(context orelse return));
    const event = slot.event;
    ring.complete(slot.sequence);

    var buffer: [2048]u8 = undefined;
    var fixed = std.heap.FixedBufferAllocator.init(&buffer);
    var arena = std.heap.ArenaAllocator.init(fixed.allocator());
    defer arena.deinit();
    const env = napi.Env{ .handle = raw_env, .arena = &arena };

    const value = env.toJs(event) catch return;
    var receiver: c.napi_value = undefined;
    if (c.napi_get_undefined(raw_env, &receiver) != .ok) return;
    var result: c.napi_value = undefined;
    const call = c.napi_call_function(raw_env, receiver, js_callback, 1, @ptrCast(&value.handle), &result);
    if (call == .ok) return;
    // A JavaScript exception is left pending on purpose: Node reports it as an
    // uncaught exception, which is where a throwing dispatch handler belongs, and
    // clearing it here would hide a real bug. Any other failure has no such
    // channel, so it is reported on stderr rather than discarded, which is what
    // the previous `_ =` did with it.
    var pending: bool = false;
    if (c.napi_is_exception_pending(raw_env, &pending) == .ok and pending) return;
    std.debug.print("ventijs: dispatch callback failed with napi status {d}\n", .{@intFromEnum(call)});
}
