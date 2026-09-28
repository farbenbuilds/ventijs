//! Native server lifecycle: create, listen, close, finalize. Create and finalize run on
//! the Node main thread and own every allocation; the engine event loop runs on its own
//! thread, is started by `listen`, and is stopped through the cluster's threadsafe wakeup.
//! The last event an engine thread emits is `server_closed`, and finalize joins that
//! thread and refuses to free anything while events are queued, so a dispatch callback
//! cannot touch freed memory.

const std = @import("std");
const builtin = @import("builtin");
const napi = @import("napi-zig");
const cleanup = @import("server_cleanup.zig");
const connections = @import("connections.zig");
const instance = @import("instance.zig");
const options = @import("options.zig");
const ports = @import("ports.zig");

/// Builds the engine application around an already-trusted configuration.
pub fn create(config: options.ServerConfig, dispatch: napi.Callback, env: napi.Env) !u40 {
    const handle = try instance.servers.claim();
    errdefer instance.servers.retire(handle);

    const target = try std.heap.smp_allocator.create(instance.Instance);
    errdefer std.heap.smp_allocator.destroy(target);

    target.* = .{
        .config = config,
        .cluster = undefined,
        .handle = handle,
        .env = env.handle,
    };
    try target.channel.open(env, dispatch);
    errdefer target.channel.close();

    try cleanup.register(env, target);
    errdefer cleanup.remove(target);

    target.cluster = try instance.ClusterType.init_with_options(
        std.heap.smp_allocator,
        target.io.io(),
        instance.EngineConfig,
        .{ .cpu_affinity = false },
    );
    errdefer target.cluster.deinit();

    try connections.attach_route(target);
    instance.servers.publish(handle, target, env.handle);
    return handle.to_int();
}

/// Binds the listener and starts the engine thread. The engine thread emits
/// `listening` after it owns the tsfn, so `listening` always precedes any
/// connection event.
pub fn listen(target: *instance.Instance) !void {
    if (target.state.load(.acquire) != .created) return error.InvalidServerState;
    try target.cluster.listen(target.config.listen.host_slice(), target.config.listen.port);
    target.bound_port = bound_port(target);
    target.state.store(.listening, .release);
    target.runner = std.Thread.spawn(.{}, run_engine, .{target}) catch |err| {
        cleanup.remove(target);
        cleanup.destroy(target);
        return err;
    };
}

/// Requests shutdown. Completion arrives as a `server_closed` event.
pub fn close(target: *instance.Instance) !void {
    switch (target.state.load(.acquire)) {
        .created => {
            if (target.state.cmpxchgStrong(.created, .closed, .acq_rel, .acquire) != null) {
                return error.InvalidServerState;
            }
            _ = target.channel.emit_shutdown(.{
                .kind = .server_closed,
                .server = target.handle.to_int(),
            });
        },
        .listening => {
            if (target.state.cmpxchgStrong(.listening, .closing, .acq_rel, .acquire) != null) {
                return error.InvalidServerState;
            }
            target.cluster.request_shutdown();
        },
        .closing, .closed => return error.InvalidServerState,
    }
}

/// Joins the engine thread and releases every native resource.
///
/// The join happens before the pending check: once the engine thread is gone no new event
/// can be reserved, so `pending == 0` proves every queued dispatch has already run.
/// Finalizing early returns `EventsPending` rather than freeing memory a queued callback
/// still references.
pub fn finalize(target: *instance.Instance) !void {
    if (target.state.load(.acquire) != .closed) return error.ServerNotClosed;
    if (target.runner) |runner| {
        runner.join();
        target.runner = null;
    }
    if (target.channel.pending() != 0) return error.EventsPending;

    cleanup.remove(target);
    cleanup.destroy(target);
}

fn run_engine(target: *instance.Instance) void {
    const acquired = target.channel.acquire();
    _ = target.channel.emit(.{
        .kind = .listening,
        .server = target.handle.to_int(),
        .code = target.bound_port,
    });
    target.cluster.run() catch {
        _ = target.channel.emit_shutdown(.{ .kind = .engine_error, .server = target.handle.to_int() });
    };
    target.state.store(.closed, .release);
    _ = target.channel.emit_shutdown(.{ .kind = .server_closed, .server = target.handle.to_int() });
    if (acquired) target.channel.release();
}

/// Best-effort local port of the bound listener. POSIX reads it back from the
/// socket so `port: 0` reports the ephemeral port; Windows keeps the requested
/// port because its listener is not a POSIX descriptor.
fn bound_port(target: *instance.Instance) u16 {
    if (builtin.os.tag == .windows) return target.config.listen.port;
    const app = target.cluster.worker(0) orelse return target.config.listen.port;
    const server = app.server orelse return target.config.listen.port;
    return ports.bound_port(server.listener.fd) orelse target.config.listen.port;
}
