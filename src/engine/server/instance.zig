//! One live engine server and the bounded table of live instances.
//!
//! `Instance` is allocated once, never moved, and owns everything the engine
//! thread and the Node main thread share: the configuration copy, the
//! generation-checked connection slab, the callback channel, and the cluster
//! that hosts the event loop.

const std = @import("std");
const napi = @import("napi-zig");
const uwz = @import("uWebZockets");
const callbacks = @import("../channel/callbacks.zig");
const engine_config = @import("engine_config.zig");
const handles = @import("../socket/handles.zig");
const options = @import("options.zig");
const payload = @import("../socket/payload.zig");
const registry = @import("registry.zig");
const socket = @import("../socket/socket.zig");

const c = napi.c;

/// Concurrent server instances, one comptime trampoline set each.
pub const server_capacity: usize = 16;

pub const State = enum(u8) { created, listening, closing, closed };

pub const AppType = uwz.ConfiguredAppWithTimeout(
    options.connection_capacity,
    options.message_capacity,
    options.write_queue_capacity,
    options.idle_timeout_ms,
);
pub const ClusterType = AppType.cluster(1);
/// Engine configuration the cluster is built from; see `engine_config.zig`.
pub const EngineConfig = engine_config.EngineConfig;
pub const Slab = handles.connection_slab(options.connection_capacity);
pub const Table = registry.slot_table(server_capacity, Instance);
pub const Handle = registry.Handle;

/// Outbound payload slots staged per server. Slot bytes equal the trusted
/// message cap, so every accepted message fits exactly one record.
pub const payload_slots: usize = 8;

/// Inbound slots, deliberately deeper than the outbound ring.
///
/// The two directions drain under different conditions. An outbound payload is
/// taken by the `pump` that staged it, in the same call, so eight slots is
/// ample. An inbound payload waits for the Node main thread to reach the next
/// threadsafe-function callback, and the engine thread keeps reading its socket
/// in the meantime, so the depth is the burst budget: a peer that delivers more
/// messages than this before the main thread turns has the excess counted as
/// dropped by `serverDroppedMessages`.
///
/// The engine's WebSocket behavior exposes no way to stop reading once a
/// consumer falls behind, so the buffer is the only place to absorb a burst.
/// At the configured 32 KiB message cap this is 2 MiB per live server.
pub const inbound_slots: usize = 64;
pub const PayloadRing = payload.payload_ring(payload_slots, @as(usize, options.message_capacity));
pub const InboundRing = payload.payload_ring(inbound_slots, @as(usize, options.message_capacity));
pub const Sockets = socket.socket_slab(options.connection_capacity, PayloadRing, InboundRing);

/// Mutable process-wide binding table. This is the one module-level variable
/// in the addon: the engine callback ABI carries no user context, so the
/// bounded table is how a callback finds its server. It is only written by
/// create/finalize on the Node main thread, read by engine callbacks, and
/// reached from JavaScript only through generation-checked handles.
pub var servers: Table = .{};

/// One live engine server. Fields are ordered largest first.
pub const Instance = struct {
    sockets: Sockets = .{},
    channel: callbacks.Channel = .{},
    slab: Slab = .{},
    config: options.ServerConfig,
    io: std.Io.Threaded = std.Io.Threaded.init_single_threaded,
    cluster: ClusterType,
    runner: ?std.Thread = null,
    state: std.atomic.Value(State) = .init(.created),
    handle: Handle,
    env: c.napi_env,
    /// Actual local port resolved after `listen`; equals the requested port
    /// when the listener cannot be queried (Windows).
    bound_port: u16 = 0,
};

/// Resolves a JavaScript server handle and rejects handles owned by another
/// Node.js environment (worker thread), so one isolate cannot drive another's
/// server. The owning environment is checked inside the slot table, before the
/// instance pointer is loaded, so a worker teardown cannot race the lookup
/// into freed memory.
pub fn lookup(env: napi.Env, raw: u40) ?*Instance {
    return servers.lookup(Handle.from_int(raw), env.handle);
}

/// Engine-thread lookup for a comptime trampoline slot.
pub fn lookup_slot(slot: u32) ?*Instance {
    return servers.lookup_slot(slot);
}

/// Resolves a packed connection handle and returns it only when the slab still
/// holds that exact generation. Every FFI entry point goes through here, so a
/// call against a closed connection returns a typed status instead of
/// dereferencing a stale slot.
pub fn resolve_connection(target: *Instance, raw: u64) ?handles.Handle {
    const handle = handles.Handle.from_int(raw);
    _ = target.slab.resolve(handle) orelse return null;
    return handle;
}
