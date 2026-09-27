const napi = @import("napi-zig");
const uwz = @import("uWebZockets");
const build_options = @import("build_options");
const codec_lifecycle = @import("engine/ffi/codec_lifecycle.zig");
const codec_out = @import("engine/ffi/codec_encode.zig");
const codec_io = @import("engine/ffi/codec_io.zig");
const codec_status = @import("engine/ffi/codec_status.zig");
const server_io = @import("engine/ffi/server_io.zig");
const socket_io = @import("engine/ffi/socket_io.zig");
const socket_inbound = @import("engine/ffi/socket_inbound.zig");
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

/// The capacities the addon was compiled with.
pub const engine_limits = server_io.engine_limits;

/// Builds a frame codec and returns a generation-checked handle.
pub const codec_create = codec_lifecycle.codec_create;
/// Releases a frame codec.
pub const codec_destroy = codec_lifecycle.codec_destroy;
/// Folds bytes into a codec, reporting how many it consumed.
pub const codec_feed = codec_io.codec_feed;
/// Where the last `codec_feed` stopped, for a caller resuming a partial input.
pub const codec_resume = codec_io.codec_resume;
/// The close code a refused frame maps to, or 0 while healthy.
pub const codec_failure_code = codec_status.codec_failure_code;
/// The failure a refused frame produced, or 0 while healthy.
pub const codec_failure = codec_status.codec_failure;
/// Events waiting to be taken.
pub const codec_pending = codec_io.codec_pending;
/// Selects the next event.
pub const codec_select = codec_io.codec_select;
/// The selected event as `[kind, code, payload]`.
pub const codec_event = codec_io.codec_event;
/// Retires the selected event.
pub const codec_take = codec_io.codec_take;
/// The fragment boundaries of the selected data message, or null when it arrived whole.
pub const codec_fragments = codec_io.codec_fragments;
/// Formats one frame, reporting its framed length.
pub const codec_encode = codec_out.codec_encode;
/// The framed bytes waiting to be copied out.
pub const codec_outbound = codec_out.codec_outbound;
/// Whether the last encoded frame was masked.
pub const codec_outbound_masked = codec_out.codec_outbound_masked;
/// Drops every buffered byte and event.
pub const codec_reset = codec_io.codec_reset;
/// The role a codec was created for.
pub const codec_ceilings = codec_status.codec_ceilings;

pub const codec_role = codec_status.codec_role;

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
pub const take_socket_message = socket_inbound.take_socket_message;
/// Drops the staged inbound messages of a connection that has closed.
pub const purge_socket_message = socket_inbound.purge_socket_message;
/// Bytes staged behind a connection handle and not yet drained.
pub const socket_buffered_amount = socket_io.socket_buffered_amount;
/// Inbound messages lost to a refused stage, a pause, or a closed connection.
pub const server_dropped_messages = socket_inbound.server_dropped_messages;
/// Staged payloads the engine refused after the pump had taken them off the ring.
pub const server_undelivered_messages = socket_pump.server_undelivered_messages;
