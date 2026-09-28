//! Trusted engine application configuration: the engine rejects a runtime configuration whose
//! capacities differ from those compiled into its application type.

const uwz = @import("uWebZockets");
const options = @import("options.zig");

/// The engine carves the HTTP/2 session and radix router regions unconditionally, and its
/// defaults fill about 82 percent of the per-server startup slab with a transport ventijs
/// never negotiates -- the listener is plaintext, so no ALPN, so no HTTP/2 session. Narrowing
/// saves about 31 MB per instance at 128 connections; raising these is not a tuning knob.
const h2_header_block_size: usize = 1024;
const h2_response_header_size: usize = 1024;
/// HTTP/2 response fields one WebSocket upgrade response can carry.
const h2_response_header_count: usize = 8;
/// Radix nodes for the single registered route: one node holds one path segment.
const route_node_capacity: usize = 16;
/// Route path bytes kept for introspection; the engine requires one max-length path, 2048 bytes.
const route_registry_capacity: usize = 4 * 1024;

/// The development log stays off: a library must never write to the host process's streams.
pub const EngineConfig = uwz.ServerConfig{
    .max_connections = options.connection_capacity,
    .max_ws_message_size = options.message_capacity,
    .write_queue_size = options.write_queue_capacity,
    .max_body_size = options.body_capacity,
    .idle_timeout_ms = options.idle_timeout_ms,
    .enable_dev_log = false,
    .max_h2_header_block_size = h2_header_block_size,
    .max_h2_body_size = options.body_capacity,
    .max_h2_response_header_size = h2_response_header_size,
    .max_h2_response_header_count = h2_response_header_count,
    .max_route_nodes = route_node_capacity,
    .max_pattern_routes = 0,
    .max_middleware = 0,
    .max_route_registry_size = route_registry_capacity,
};
