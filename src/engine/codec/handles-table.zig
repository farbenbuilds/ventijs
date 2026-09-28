//! The bounded table of live codecs, process-wide because a codec's owner is Node and the Node-API callback ABI carries no user context.

const std = @import("std");
const capacities = @import("capacities.zig");
const state = @import("state.zig");

/// Which side of the connection enforces masking; `handles.zig` owns the vocabulary.
pub const Role = enum(u8) { client, server };

const Codec = state.codec(capacities.control_slots);

/// One table entry: the word decides whether a handle resolves, the pointer is what it resolves to.
pub const Slot = struct {
    word: std.atomic.Value(u64) = .init(0),
    /// The live codec, or null when the slot is free, so a stale read cannot return a codec.
    codec: ?*Codec = null,
    role: Role = .server,
};

/// Mutable process-wide binding table, written only by create/destroy on the Node main
/// thread and read through generation-checked handles.
pub var table: [capacities.codec_capacity]Slot = [_]Slot{.{}} ** capacities.codec_capacity;
