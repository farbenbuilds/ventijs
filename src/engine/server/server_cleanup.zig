//! Environment-teardown cleanup for servers a worker never finalized: Node drains the
//! threadsafe function's queue with a null environment, so no dispatch sees a freed ring.

const std = @import("std");
const napi = @import("napi-zig");
const instance = @import("instance.zig");

const c = napi.c;

/// Frees `target` if its environment is torn down before `remove` runs.
pub fn register(env: napi.Env, target: *instance.Instance) !void {
    if (c.napi_add_env_cleanup_hook(env.handle, on_env_cleanup, target) != .ok) {
        return error.EnvCleanupUnavailable;
    }
}

/// Removes the hook before a normal finalize frees the instance.
pub fn remove(target: *instance.Instance) void {
    _ = c.napi_remove_env_cleanup_hook(target.env, on_env_cleanup, target);
}

fn on_env_cleanup(raw: ?*anyopaque) callconv(.c) void {
    const target: *instance.Instance = @ptrCast(@alignCast(raw orelse return));
    // Stop the channel before joining: the thread can no longer queue into a dying environment.
    target.channel.stop();
    switch (target.state.load(.acquire)) {
        .listening => target.cluster.request_shutdown(),
        .created, .closing, .closed => {},
    }
    if (target.runner) |runner| {
        runner.join();
        target.runner = null;
    }
    destroy(target);
}
/// Every teardown path funnels through here, so a new resource cannot be missed in one of
/// them. The slot is retired first, not last: a comptime trampoline resolves its instance
/// through the table, and `retire` is the release store that makes the join safe.
/// nothing enforces it, and `retire` is the release store that makes it safe.
pub fn destroy(target: *instance.Instance) void {
    instance.servers.retire(target.handle);
    target.channel.close();
    target.cluster.deinit();
    std.heap.smp_allocator.destroy(target);
}
