//! One live engine server and the bounded table of live instances. `Instance` is allocated
//! once, never moved, and owns everything the engine thread and the Node main thread share.

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

/// Outbound payload slots staged per server; slot bytes equal the trusted message cap.
pub const payload_slots: usize = 8;

/// Inbound slots, deliberately deeper than the outbound ring: an outbound payload is taken
/// by the `pump` that staged it, while an inbound one waits for the main thread. The depth is
/// the burst budget -- the engine cannot stop reading once a consumer falls behind. At the
/// 64 KiB message cap that is 4 MiB per server; the excess is `serverDroppedMessages`.
pub const inbound_slots: usize = 64;
pub const PayloadRing = payload.payload_ring(payload_slots, @as(usize, options.message_capacity));
pub const InboundRing = payload.payload_ring(inbound_slots, @as(usize, options.message_capacity));
pub const Sockets = socket.socket_slab(options.connection_capacity, PayloadRing, InboundRing);

/// The one module-level variable in the addon: the engine callback ABI carries no user
/// context, so the bounded table is how a callback finds its server.
pub var servers: Table = .{};

/// One live engine server. Fields are ordered largest first.
pub const Instance = struct {
    sockets: Sockets = .{},
    channel: callbacks.Channel = .{},
    slab: Slab = .{},
    config: options.ServerConfig,
    io: std.Io.Threaded = std.Io.Threaded.init_single_threaded,
    cluster: ClusterType,
    /// Staged payloads the engine refused after the pump took them out of the ring. Written on
    /// the engine thread and read on the main one, so it is atomic; see `socket_pump.flush`.
    undelivered: std.atomic.Value(u64) align(std.atomic.cache_line) = .init(0),
    runner: ?std.Thread = null,
    state: std.atomic.Value(State) = .init(.created),
    handle: Handle,
    env: c.napi_env,
    /// The local port resolved after `listen`; equals the requested port on Windows.
    bound_port: u16 = 0,
};

/// Rejects handles owned by another Node.js environment, so one isolate cannot drive another's
/// server. Checked in the table before the pointer is loaded, so a teardown cannot race it.
pub fn lookup(env: napi.Env, raw: u40) ?*Instance {
    return servers.lookup(Handle.from_int(raw), env.handle);
}

/// Engine-thread lookup for a comptime trampoline slot.
pub fn lookup_slot(slot: u32) ?*Instance {
    return servers.lookup_slot(slot);
}

/// Null means the connection was never admitted, and every caller treats it as a refusal.
pub fn connection_index(target: *Instance, ws: *uwz.WebSocket) ?u32 {
    const app = target.cluster.worker(0) orelse return null;
    const index = app.pool.index_of(ws.conn) orelse return null;
    return @intCast(index);
}

/// Resolves a packed connection handle only when the slab still holds that generation, so a
/// call against a closed connection returns a typed status instead of a stale slot.
pub fn resolve_connection(target: *Instance, raw: u64) ?handles.Handle {
    const handle = handles.Handle.from_int(raw);
    _ = target.slab.resolve(handle) orelse return null;
    return handle;
}
