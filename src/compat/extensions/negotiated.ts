/// The two facts both halves of the negotiation need, named once: `deflate.zig` states
/// them in its module doc and `offer.ts` has to act on them.

export const PERMESSAGE_DEFLATE = "permessage-deflate";

/// Declining a peer's context takeover is legal in both directions and is what
/// `uWebZockets` does on its own WebSocket route, so a message compressed on either route
/// is a message the other can read.
export const NO_CONTEXT_TAKEOVER: Readonly<Record<string, string>> = {
  server_no_context_takeover: "",
  client_no_context_takeover: "",
};
