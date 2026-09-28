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

pub fn http3_available() bool {
    return uwz.http3_available;
}

pub const engine_limits = server_io.engine_limits;

pub const codec_create = codec_lifecycle.codec_create;
pub const codec_destroy = codec_lifecycle.codec_destroy;
pub const codec_feed = codec_io.codec_feed;
/// The offset the last `codec_feed` stopped at, a read rather than a latch.
pub const codec_resume = codec_io.codec_resume;
/// The close code a refused frame maps to, 0 while healthy.
pub const codec_failure_code = codec_status.codec_failure_code;
/// The failure ordinal a refused frame produced, 0 while healthy.
pub const codec_failure = codec_status.codec_failure;
pub const codec_pending = codec_io.codec_pending;
pub const codec_select = codec_io.codec_select;
/// The selected event as `[kind, code, payload]`.
pub const codec_event = codec_io.codec_event;
pub const codec_take = codec_io.codec_take;
/// The fragment boundaries of the selected data message, null when it arrived whole.
pub const codec_fragments = codec_io.codec_fragments;
pub const codec_encode = codec_out.codec_encode;
pub const codec_outbound = codec_out.codec_outbound;
pub const codec_outbound_masked = codec_out.codec_outbound_masked;
pub const codec_reset = codec_io.codec_reset;
pub const codec_ceilings = codec_status.codec_ceilings;

pub const codec_role = codec_status.codec_role;

pub const create_server = server_io.create_server;
pub const listen_server = server_io.listen_server;
pub const close_server = server_io.close_server;
/// Releases the native resources of a closed server, after `serverClosed`.
pub const finalize_server = server_io.finalize_server;
pub const server_dropped_events = server_io.server_dropped_events;

pub const send_socket = socket_io.send_socket;
pub const close_socket = socket_io.close_socket;
pub const pause_socket = socket_io.pause_socket;
pub const resume_socket = socket_io.resume_socket;
pub const pump_socket = socket_pump.pump_socket;
/// The oldest parsed message for a connection, copied into a JavaScript-owned buffer.
pub const take_socket_message = socket_inbound.take_socket_message;
pub const purge_socket_message = socket_inbound.purge_socket_message;
pub const socket_buffered_amount = socket_io.socket_buffered_amount;
/// Inbound messages lost to a refused stage, a pause, or a closed connection.
pub const server_dropped_messages = socket_inbound.server_dropped_messages;
pub const server_undelivered_messages = socket_pump.server_undelivered_messages;
