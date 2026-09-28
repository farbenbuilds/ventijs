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

        /// The event the caller has selected with `select` and not yet taken.
        selected: bool = false,
        /// Which store the selection points at, so `take` retires the right one.
        selected_message: bool = false,

        /// Events waiting to be taken, including one already selected.
        pub fn pending(self: *const Self) usize {
            return self.count + @intFromBool(self.message != null);
        }

        /// Whether a control event can be queued without evicting one.
        pub fn has_control_room(self: *const Self) bool {
            return self.count < slots;
        }

        /// Whether a data message can be queued without overwriting the bytes of one
        /// that is already waiting.
        pub fn has_message_room(self: *const Self) bool {
            return self.message == null;
        }

        /// The copy is a control frame's whole point: the receive buffer it came from is
        /// reused by the next control frame, and a pong the caller has not written yet
        /// must still be readable when it is.
        pub fn push_control(self: *Self, event: Decoded) void {
            const slot = (self.head + self.count) % slots;
            const buffer = &self.owned[slot];
            const length = @min(event.payload.len, buffer.len);
            // RFC 6455 section 5.5 caps a control payload at 125 bytes, which is the
            // size of every slot, so a larger one can only be a bug in whatever produced
            // it. Asserted rather than truncated: a silently shortened payload would be
            // delivered as a valid frame with the wrong bytes.
            std.debug.assert(event.payload.len <= buffer.len);
            @memcpy(buffer[0..length], event.payload[0..length]);
            self.controls[slot] = .{
                .kind = event.kind,
                .code = event.code,
                .failure = event.failure,
                .payload = buffer[0..length],
            };
            self.count += 1;
        }

        /// Selection and taking are separate so the payload can be read between them:
        /// the payload borrows receive state and the caller has to copy it out before
        /// the event is retired.
        pub fn select(self: *Self) bool {
            if (self.message != null and self.count > 0 and self.controls[self.head].kind == .close) {
                self.selected = true;
                self.selected_message = true;
                return true;
            }
            if (self.count > 0) {
                self.selected = true;
                self.selected_message = false;
                return true;
            }
            if (self.message == null) return false;
            self.selected = true;
            self.selected_message = true;
            return true;
        }

        pub fn selected_event(self: *const Self) ?Decoded {
            if (!self.selected) return null;
            if (self.selected_message) return self.message;
            return self.controls[self.head];
        }

        pub fn take(self: *Self) void {
            if (!self.selected) return;
            self.selected = false;
            if (self.selected_message) {
                self.message = null;
                return;
            }
            self.controls[self.head] = undefined;
            self.head = (self.head + 1) % slots;
            self.count -= 1;
        }

        pub fn reset(self: *Self) void {
            self.head = 0;
            self.count = 0;
            self.message = null;
            self.selected = false;
            self.selected_message = false;
        }
    };
}
