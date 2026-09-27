//! The inbound message path for one server slot: stage the parsed payload, or
//! count why it was not staged.
//!
//! Split from `connections.zig` because the open, close, and route wiring are
//! lifecycle and this is data: the two change for different reasons, and the file
//! budget reflects that.

const uwz = @import("uWebZockets");
const instance = @import("instance.zig");
const payload = @import("../socket/payload.zig");
const queues = @import("../socket/queues.zig");

/// Copies one parsed message into the server's inbound ring and wakes the Node
/// main thread. The bytes only borrow the engine's own message buffer for the
/// duration of this call, so the copy is what makes the payload survive past the
/// callback.
///
/// A paused connection drops here, which is a real divergence from `ws` and is
/// recorded rather than papered over. `ws.pause()` pauses the underlying socket,
/// so the bytes stay in the kernel receive buffer and the engine never reads
/// them. The pinned engine has no per-connection read pause, and the two
/// alternatives were both worse: withholding only the wakeup leaves the payload
/// in a ring shared by every connection, so one paused peer that keeps sending
/// fills a ring of 64 slots and every other connection on the server starts
/// losing messages, and per-connection inbound rings are not implemented. A drop
/// is bounded to the connection that asked to be paused.
///
/// The drop is counted. An earlier version returned before staging without
/// touching the counter, so `serverDroppedMessages` reported zero while data was
/// being lost, which is the worst of both: unbounded and invisible.
///
/// A ring that refused the message produces no event either. Announcing one that
/// was never staged leaves JavaScript waiting for bytes that do not exist, and
/// the drop counter is the only honest evidence.
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
    if (!queues.stage_inbound(&server.sockets, index, generation, kind, bytes)) return;
    _ = server.channel.emit(.{
        .kind = .connection_message,
        .server = server.handle.to_int(),
        .index = index,
        .generation = generation,
        .code = @intCast(bytes.len),
    });
}
