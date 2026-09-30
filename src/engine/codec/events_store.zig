//! The bounded store of decoded events waiting for the caller. **Control events are a
//! ring, data messages are a single slot**: a data payload slices the receive state
//! machine's one reassembly buffer, so two queued messages would alias. Controls drain
//! first, because RFC 6455 section 5.5.2 requires a pong promptly.

const std = @import("std");

const inbound = @import("receive.zig");

const Decoded = inbound.Decoded;

pub fn event_store(comptime slots: usize) type {
    if (slots == 0) @compileError("codec needs at least one control slot");

    return struct {
        const Self = @This();

        /// Each control slot owns its payload. The receive state machine writes control
        /// payloads into one shared 125-byte buffer, so without a buffer per slot every
        /// queued control event would point at it and two pings in one read would
        /// deliver the first as the second's bytes.
        owned: [slots][inbound.control_capacity]u8 = undefined,
        /// Control events, oldest first, each pointing into its own `owned` slot.
        controls: [slots]Decoded = undefined,
        head: usize = 0,
        count: usize = 0,

        /// The one queued data message, or null when the slot is free.
        message: ?Decoded = null,

        /// Latched when a close event is queued; a message completed after that is data
        /// after a close, which `ws` drops rather than delivers (RFC 6455 section 5.5.1).
        close_queued: bool = false,

        /// The event the caller has selected with `select` and not yet taken.
        selected: bool = false,
        /// Which store the selection points at, so `take` retires the right one.
        selected_message: bool = false,

        /// Events waiting to be taken, including one already selected.
        pub fn pending(store: *const Self) usize {
            return store.count + @intFromBool(store.message != null);
        }

        /// Whether a control event can be queued without evicting one.
        pub fn has_control_room(store: *const Self) bool {
            return store.count < slots;
        }

        /// Whether a data message can be queued without overwriting the bytes of one
        /// that is already waiting.
        pub fn has_message_room(store: *const Self) bool {
            return store.message == null;
        }

        /// Whether a close event is waiting. Data frames are dropped once it is, because
        /// `ws` stops parsing at a close and only controls keep their ring order.
        pub fn has_close_queued(store: *const Self) bool {
            return store.close_queued;
        }

        /// The copy is a control frame's whole point: the receive buffer it came from is
        /// reused by the next control frame, and a pong the caller has not written yet
        /// must still be readable when it is.
        pub fn push_control(store: *Self, event: Decoded) void {
            const slot = (store.head + store.count) % slots;
            const buffer = &store.owned[slot];
            const length = @min(event.payload.len, buffer.len);
            // RFC 6455 section 5.5 caps a control payload at 125 bytes, which is the
            // size of every slot, so a larger one can only be a bug in whatever produced
            // it. Asserted rather than truncated: a silently shortened payload would be
            // delivered as a valid frame with the wrong bytes.
            std.debug.assert(event.payload.len <= buffer.len);
            @memcpy(buffer[0..length], event.payload[0..length]);
            store.controls[slot] = .{
                .kind = event.kind,
                .code = event.code,
                .failure = event.failure,
                .payload = buffer[0..length],
            };
            if (event.kind == .close) store.close_queued = true;
            store.count += 1;
        }

        /// Selection and taking are separate so the payload can be read between them:
        /// the payload borrows receive state and the caller has to copy it out before
        /// the event is retired.
        pub fn select(store: *Self) bool {
            if (store.message != null and store.count > 0 and store.controls[store.head].kind == .close) {
                store.selected = true;
                store.selected_message = true;
                return true;
            }
            if (store.count > 0) {
                store.selected = true;
                store.selected_message = false;
                return true;
            }
            if (store.message == null) return false;
            store.selected = true;
            store.selected_message = true;
            return true;
        }

        pub fn selected_event(store: *const Self) ?Decoded {
            if (!store.selected) return null;
            if (store.selected_message) return store.message;
            return store.controls[store.head];
        }

        pub fn take(store: *Self) void {
            if (!store.selected) return;
            store.selected = false;
            if (store.selected_message) {
                store.message = null;
                return;
            }
            store.controls[store.head] = undefined;
            store.head = (store.head + 1) % slots;
            store.count -= 1;
        }

        pub fn reset(store: *Self) void {
            store.head = 0;
            store.count = 0;
            store.message = null;
            store.close_queued = false;
            store.selected = false;
            store.selected_message = false;
        }
    };
}
