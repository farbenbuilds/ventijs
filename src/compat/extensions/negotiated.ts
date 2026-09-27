//! The two facts both halves of the negotiation need, named once.
//!
//! Split out because `deflate.zig` states them in its module doc and `offer.ts` has to
//! act on them, and a constant restated in two places is one that will be changed in one.

export const PERMESSAGE_DEFLATE = "permessage-deflate";

/// The two parameters this codec always negotiates, and the reason is in `deflate.zig`'s
/// module doc. Declining a peer's context takeover is legal in both directions and is
/// what `uWebZockets` does on its own WebSocket route, so a message compressed on either
/// route is a message the other can read.
export const NO_CONTEXT_TAKEOVER: Readonly<Record<string, string>> = {
  server_no_context_takeover: "",
  client_no_context_takeover: "",
};
