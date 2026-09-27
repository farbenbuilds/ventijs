const napi = @import("napi-zig");
const uwz = @import("uWebZockets");
const build_options = @import("build_options");
const server_io = @import("engine/ffi/server_io.zig");
const socket_io = @import("engine/ffi/socket_io.zig");
const socket_pump = @import("engine/ffi/socket_pump.zig");

comptime {
    napi.module(@This());
}

/// Version of the linked uWebZockets engine, for example "1.7.0".
pub fn engine_version() []const u8 {
    return build_options.engine_version;
}

/// Whether the linked engine includes the HTTP/3 transport.
pub fn http3_available() bool {
    return uwz.http3_available;
}

/// Validates an untrusted configuration, builds an engine server around a
/// dispatch function, and returns a generation-checked server handle.
pub const create_server = server_io.create_server;
/// Binds the listener and starts the engine thread for a server handle.
pub const listen_server = server_io.listen_server;
/// Requests shutdown of a listening server.
pub const close_server = server_io.close_server;
/// Releases the native resources of a closed server after `serverClosed`.
pub const finalize_server = server_io.finalize_server;
/// Events the server channel could not queue because its ring was full.
pub const server_dropped_events = server_io.server_dropped_events;

/// Stages one outbound text or binary message behind a connection handle.
pub const send_socket = socket_io.send_socket;
/// Validates and stages the close frame behind a connection handle.
pub const close_socket = socket_io.close_socket;
/// Suspends inbound message dispatch behind a connection handle.
pub const pause_socket = socket_io.pause_socket;
/// Resumes inbound message dispatch behind a connection handle.
pub const resume_socket = socket_io.resume_socket;
/// Hands one connection's staged payloads to the engine thread.
pub const pump_socket = socket_pump.pump_socket;
/// Takes the oldest parsed message for a connection as a JavaScript-owned buffer.
pub const take_socket_message = socket_pump.take_socket_message;
/// Bytes staged behind a connection handle and not yet drained.
pub const socket_buffered_amount = socket_io.socket_buffered_amount;
/// Inbound messages the inbound ring refused because JavaScript fell behind.
pub const server_dropped_messages = socket_pump.server_dropped_messages;
