//! Engine-to-JavaScript event vocabulary. Fixed-size scalar records only, so the channel can
//! copy an event into its ring without allocating; message bytes stay in the inbound ring.

/// Event kinds mirrored by `ENGINE_EVENT_KINDS` in `src/binding/native.ts`, sent as the camelCase tag name.
pub const Kind = enum(u8) {
    listening,
    connection_open,
    connection_message,
    connection_close,
    engine_error,
    server_closed,
};

/// One engine-thread event. `server` is the packed, generation-checked handle; `code` is the
/// bound port for `listening` or the staged length for a message; `sequence` names the staged
/// record so a take cannot serve an older message whose own announcement the ring dropped.
pub const Event = struct {
    kind: Kind,
    server: u40,
    index: u32 = 0,
    generation: u32 = 0,
    code: u32 = 0,
    sequence: u32 = 0,
};
