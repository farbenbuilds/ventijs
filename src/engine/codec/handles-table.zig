//! The bounded table of live codecs, process-wide because a codec's owner is Node and the
//! Node-API callback ABI carries no user context; worker threads share it, so fields are atomic.

const std = @import("std");
const napi = @import("napi-zig");
const capacities = @import("capacities.zig");
const slot_word = @import("packed.zig");
const state = @import("state.zig");

const c = napi.c;

/// Which side of the connection enforces masking; `handles.zig` owns the vocabulary.
pub const Role = enum(u8) { client, server };

const Codec = state.codec(capacities.control_slots);

/// One entry: the word decides whether a handle resolves, the environment decides who may touch it.
pub const Slot = struct {
    word: std.atomic.Value(u64) = .init(0),
    /// The live codec, or null when the slot is free, so a stale read cannot return a codec.
    codec: std.atomic.Value(?*Codec) = .init(null),
    /// Compared before the pointer is loaded, so a foreign handle cannot reach another environment's codec.
    env: std.atomic.Value(?c.napi_env) = .init(null),
    role: std.atomic.Value(Role) = .init(.server),
};

/// Written only by create/destroy on each environment's own thread, read through checked handles.
pub var table: [capacities.codec_capacity]Slot = [_]Slot{.{}} ** capacities.codec_capacity;

/// Live codecs, for a test that asserts the table is balanced.
pub fn live_count() usize {
    var count: usize = 0;
    for (&table) |*slot| {
        if (slot_word.state_of(slot.word.load(.acquire)) == .active) count += 1;
    }
    return count;
}

/// Live codecs owned by `env`, the count the cleanup hook's register/remove pairing uses.
pub fn env_count(env: c.napi_env) usize {
    var count: usize = 0;
    for (&table) |*slot| {
        if (slot_word.state_of(slot.word.load(.acquire)) != .active) continue;
        if (slot.env.load(.acquire) == env) count += 1;
    }
    return count;
}
