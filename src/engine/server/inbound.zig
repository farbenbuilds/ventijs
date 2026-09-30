//! The inbound message path for one server slot: stage the parsed payload, or count
//! why it was not staged.

const uwz = @import("uWebZockets");
const instance = @import("instance.zig");
const payload = @import("../socket/payload.zig");
const queues = @import("../socket/queues.zig");

/// **A paused connection drops here, a real divergence from `ws`.** `ws.pause()` pauses
/// the socket so the bytes stay in the kernel receive buffer, and the pinned engine has no
/// per-connection read pause. Withholding only the wakeup would leave the payload in a
/// ring shared by every connection, so one paused peer that keeps sending starves every
/// other connection on the server. A drop is bounded to the connection that asked for it
/// and is counted; a ring that refused the message produces no event either.
pub fn on_message(slot: usize, ws: *uwz.WebSocket, bytes: []const u8, opcode: uwz.Opcode) void {
    const server = instance.lookup_slot(@intCast(slot)) orelse return;
    const index = instance.connection_index(server, ws) orelse return;
    if (server.sockets.is_paused(index)) {
        queues.count_dropped(&server.sockets);
        return;
    }
    const generation = server.slab.generation_at(index) orelse return;
    const kind: payload.Kind = switch (opcode) {
        .text => .text,
        else => .binary,
    };
    const sequence = queues.stage_inbound(&server.sockets, index, generation, kind, bytes) orelse return;
    _ = server.channel.emit(.{
        .kind = .connection_message,
        .server = server.handle.to_int(),
        .index = index,
        .generation = generation,
        .code = @intCast(bytes.len),
        .sequence = @truncate(sequence),
    });
}
