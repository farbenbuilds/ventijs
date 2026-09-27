//! Engine-to-JavaScript event vocabulary.
//!
//! Fixed-size records only: every field is a scalar so the channel can copy
//! an event into its ring without allocating and the TypeScript side can
//! rebuild connection handles from `index` and `generation`. Message bytes
//! deliberately do not travel here; they wait in the server's inbound payload
//! ring and the JavaScript side pulls them with `takeSocketMessage`.

/// Event kinds mirrored by `ENGINE_EVENT_KINDS` in `src/binding/native.ts`.
/// The bridge serializes a kind as the camelCase form of its tag name, not as
/// an ordinal, so a new kind is added in reading order and the JavaScript union
/// is extended to match. Per-connection *operation results* are the ones that
/// cross as ordinals, and those live in `socket/status.zig`.
pub const Kind = enum(u8) {
    listening,
    connection_open,
    connection_message,
    connection_close,
    engine_error,
    server_closed,
};

/// One engine-thread event. `server` is the packed, generation-checked server
/// handle; `code` carries a status detail such as the bound port for
/// `listening` (the requested port on platforms without descriptor
/// introspection). For `connection_message` it is the payload length in bytes
/// as staged in the inbound ring.
pub const Event = struct {
    kind: Kind,
    server: u40,
    index: u32 = 0,
    generation: u32 = 0,
    code: u32 = 0,
};
