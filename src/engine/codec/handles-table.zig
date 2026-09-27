//! The bounded table of live codecs.
//!
//! The engine's own connection slab is one per server and sized by the engine's
//! pool, because the engine owns the sockets. A codec's owner is Node: the transport
//! is a `net.Socket` or a `tls.TLSSocket` the compatibility layer accepted, and its
//! count is whatever the application opened. So this is a process-wide table rather
//! than a per-server one, and it is the second sanctioned module-level variable in
//! the addon, for the same reason `server/instance.zig` is the first: the Node-API
//! callback ABI carries no user context, and a codec handle is all a call site has to
//! go on.
//!
//! **A slot is a word pair, not a codec.** The codec is heap-allocated by `create` and
//! freed by `destroy`, so the table's fixed cost is `codec_capacity * 16` bytes and
//! the per-connection cost is charged to the connection. A table of inlined codecs
//! would reserve a message buffer per slot at load time, which is the difference
//! between a limit and a bug.

const std = @import("std");
const capacities = @import("capacities.zig");
const state = @import("state.zig");

/// Which side of the connection enforces masking. Re-declared here so the slot can
/// name it; `handles.zig` is the module that owns the vocabulary.
pub const Role = enum(u8) { client, server };

const Codec = state.codec(capacities.control_slots);

/// One table entry: the word decides whether a handle resolves, the pointer is what
/// it resolves to. See `packed.zig` for why state and generation share a word.
pub const Slot = struct {
    word: std.atomic.Value(u64) = .init(0),
    /// The live codec, or null when the slot is free. Null rather than an undefined
    /// inlined value so a stale read of a freed slot cannot return something that
    /// looks like a codec.
    codec: ?*Codec = null,
    role: Role = .server,
};

/// Mutable process-wide binding table. Written only by create/destroy on the Node
/// main thread and read through generation-checked handles: the invariant
/// `CODING_CONVENTION.md` states for the server table, and the reason a second
/// module-level variable is allowed to exist.
pub var table: [capacities.codec_capacity]Slot = [_]Slot{.{}} ** capacities.codec_capacity;
