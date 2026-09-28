//! The bounded table of live codecs. Process-wide rather than per-server, because a
//! codec's owner is Node -- its count is whatever the application opened -- and the
//! Node-API callback ABI carries no user context, so a codec handle is all a call
//! site has to go on.

const std = @import("std");
const capacities = @import("capacities.zig");
const state = @import("state.zig");

/// Which side of the connection enforces masking. Re-declared here so the slot can
/// name it; `handles.zig` owns the vocabulary.
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
