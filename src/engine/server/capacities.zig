//! Compile-time capacities baked into the engine application type.
//!
//! The engine generates its application type from these values and rejects a
//! runtime configuration that disagrees with them, so nothing here can be a
//! runtime option. Each one is also a promise the compatibility layer has to
//! keep, which is why the interesting ones carry their reason.

/// Concurrent connections per server. The engine's per-connection footprint is
/// dominated by the message slab and the write queue, so this is the main memory
/// knob; keep it deliberately modest.
pub const connection_capacity: u32 = 128;

/// Largest message the engine accepts or produces, in either direction.
pub const message_capacity: u32 = 32 * 1024;

/// Largest single frame. A frame can never exceed a message, so it tracks it.
pub const frame_capacity: u32 = message_capacity;

/// Headroom above the message cap for the connection write queue.
///
/// The queue has to hold a maximum-size frame *plus* its header, so sizing it
/// equal to `message_capacity` cannot make progress on the largest frame the
/// server accepts: the frame fills the queue before the header lands, the
/// engine's `WebSocket.send` fails, and the topic publisher swallows the
/// failure, so the payload disappears instead of reaching the peer. The engine's
/// own Autobahn target makes the same allowance.
///
/// At 128 connections this headroom is 8 MiB per server, which makes it the
/// dominant per-connection term after the message slab.
pub const write_queue_headroom: u32 = 64 * 1024;
pub const write_queue_capacity: u32 = message_capacity + write_queue_headroom;

/// Largest request body the engine accepts, on HTTP/1.1 and per HTTP/2 stream
/// alike. A WebSocket upgrade never carries one, so this only sizes the engine's
/// per-connection request buffer and the narrowed HTTP/2 stream.
pub const body_capacity: u32 = 4 * 1024;

/// Inactivity timeout the engine application type is compiled with. Zero leaves
/// the engine's connection sweeper unstarted, so a connection lives until the
/// peer or the application ends it. `ws` has no idle timeout, so there is no
/// engine-side default to match either.
pub const idle_timeout_ms: u64 = 0;

/// Fixed storage limits for host and route path. The extra byte holds the NUL
/// sentinel the engine's `[]const u8` listeners expect.
pub const host_capacity = 254;
pub const path_capacity = 256;

/// RFC 6455 section 5.5 caps every control frame at 125 bytes, so a close frame
/// must always fit inside the configured frame cap.
pub const min_frame_bytes: u32 = 125;
pub const max_port: u32 = 65_535;
pub const max_backlog: u32 = 65_535;
