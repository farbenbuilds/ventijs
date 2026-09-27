//! The bounded store of decoded events waiting for the caller.
//!
//! Split out of the codec because the queue is where the codec's memory bound
//! lives, and the reasoning behind that bound is not obvious from the struct that
//! uses it. Two decisions are encoded here and nowhere else.
//!
//! **Control events are a ring, data messages are a single slot.** A control
//! payload is capped at 125 bytes by RFC 6455 section 5.5, so a ring of them
//! costs `slots * 125` bytes and a peer may legitimately interleave many into one
//! read. A data message's payload is a slice into the receive state machine's
//! single reassembly buffer, so two queued data messages would both point into it
//! and the second would overwrite the first: a caller reading the first would
//! read the second's bytes, with nothing to tell it apart. One slot is the only
//! arrangement that cannot do that.
//!
//! **Control events are drained first.** A ping the caller has not answered has a
//! deadline the rest of the queue does not, and section 5.5.2 requires a pong
//! promptly, so delivering a large message ahead of it is the wrong order even
//! though both orders are protocol-legal.

const inbound = @import("receive.zig");

const Decoded = inbound.Decoded;

pub fn event_store(comptime slots: usize) type {
    if (slots == 0) @compileError("codec needs at least one control slot");

    return struct {
        const Self = @This();

        /// Control events, oldest first.
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

        /// Whether a data message can be queued without overwriting the bytes of
        /// one that is already waiting.
        pub fn has_message_room(self: *const Self) bool {
            return self.message == null;
        }

        pub fn push_control(self: *Self, event: Decoded) void {
            const slot = (self.head + self.count) % slots;
            self.controls[slot] = event;
            self.count += 1;
        }

        /// Selects the oldest event, or reports that there is none.
        ///
        /// Selection and taking are separate so the payload can be read between
        /// them: the payload borrows receive state, and the caller has to copy it
        /// out before the event is retired.
        pub fn select(self: *Self) bool {
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

        /// Retires the selected event and frees its slot.
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
