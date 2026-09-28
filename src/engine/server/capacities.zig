//! Compile-time capacities baked into the engine application type, which rejects a runtime configuration that disagrees.

/// Concurrent connections per server. The per-connection footprint is dominated by the message slab and the write queue, so this is the main memory knob and is kept deliberately modest.
pub const connection_capacity: u32 = 128;

/// Largest message the engine accepts or produces, in either direction. 64 KiB is where RFC 6455's suite needs it: group 1 delivers 65535- and 65536-byte payloads and `zslay` closes all six with 1009. This is the engine route's ceiling, not the public surface's, whose codec sizes per connection from `maxPayload`.
pub const message_capacity: u32 = 64 * 1024;

/// Largest single frame, which can never exceed a message and so tracks it.
pub const frame_capacity: u32 = message_capacity;

/// Headroom above the message cap for the write queue, which holds a maximum-size frame *plus* its header: sized equal to `message_capacity` the frame fills the queue before the header lands, `send` fails, and the payload disappears. At 128 connections this is 8 MiB per server, the dominant term after the message slab.
pub const write_queue_headroom: u32 = 64 * 1024;
pub const write_queue_capacity: u32 = message_capacity + write_queue_headroom;

/// Largest request body, on HTTP/1.1 and per HTTP/2 stream alike. A WebSocket upgrade never carries one, so this only sizes the request buffer and the narrowed HTTP/2 stream.
pub const body_capacity: u32 = 4 * 1024;

/// Inactivity timeout the application type is compiled with. Zero leaves the engine's sweeper unstarted, and `ws` has no idle timeout, so there is nothing to match.
pub const idle_timeout_ms: u64 = 0;

/// Fixed storage limits for host and route path; the extra byte holds the NUL sentinel the engine's `[]const u8` listeners expect.
pub const host_capacity = 254;
pub const path_capacity = 256;

/// RFC 6455 section 5.5 caps a control frame at 125 bytes, so a close frame must always fit the frame cap.
pub const min_frame_bytes: u32 = 125;
pub const max_port: u32 = 65_535;
pub const max_backlog: u32 = 65_535;
