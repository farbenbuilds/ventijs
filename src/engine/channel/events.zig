//! Engine-to-JavaScript event vocabulary. Fixed-size scalar records only, so the channel can
//! copy an event into its ring without allocating; message bytes stay in the inbound ring.

/// Event kinds mirrored by `ENGINE_EVENT_KINDS` in `src/binding/native.ts`; the bridge sends
/// a kind as the camelCase form of its tag name rather than an ordinal.
pub const Kind = enum(u8) {
    listening,
    connection_open,
    connection_message,
    connection_close,
    engine_error,
    server_closed,
};

/// One engine-thread event. `server` is the packed, generation-checked handle; `code` carries
/// a status detail: the bound port for `listening`, the staged payload length for a message.
pub const Event = struct {
    kind: Kind,
    server: u40,
    index: u32 = 0,
    generation: u32 = 0,
    code: u32 = 0,
};
