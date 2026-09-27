//! Environment-teardown cleanup for servers a worker never finalized.
//!
//! A worker that creates a server and exits without `finalizeServer` would
//! otherwise leak the engine thread, the listener, and the instance for the
//! process lifetime. The cleanup hook runs on the Node main thread during
//! environment teardown: it stops the engine thread, retires the handle, and
//! frees every resource. Node drains the threadsafe function's queue with a
//! null environment while the channel closes, so no queued dispatch can
//! observe the freed ring.

const std = @import("std");
const napi = @import("napi-zig");
const instance = @import("instance.zig");

const c = napi.c;

/// Registers the hook that frees `target` if its environment is torn down
/// before `remove` runs.
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
    // Stop the channel before the engine thread is joined: the thread can no
    // longer queue a dispatch into an environment that is going away.
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

/// Releases every native resource an instance owns and frees it. Every
/// teardown path funnels through here, so a new resource cannot be missed in
/// one of them. The caller must have joined the engine thread and removed the
/// environment cleanup hook; the hook's own path calls this directly because
/// Node is already running it.
///
/// The slot is retired first, not last. A comptime trampoline resolves its
/// instance through the table, and `cluster.deinit()` tears down the event loop
/// those trampolines run on. Retiring after the deinit left a window in which a
/// callback that was already in flight could resolve a slot whose cluster was
/// half destroyed. Both current callers join the engine thread first, so the
/// window was empty, but nothing in the type system or in this function's
/// contract enforced that, and `retire` is the release store that makes the
/// ordering safe rather than merely currently-true.
pub fn destroy(target: *instance.Instance) void {
    instance.servers.retire(target.handle);
    target.channel.close();
    target.cluster.deinit();
    std.heap.smp_allocator.destroy(target);
}
