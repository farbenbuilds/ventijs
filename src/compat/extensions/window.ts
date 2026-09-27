//! Writing a window this codec cannot honour, which it never does.
//!
//! Split out of `deflate.zig` because the answer and the offer both need the same rule
//! and it is a rule about the *compressor*, not about either direction: the answer writes
//! a window only when the option asks for one this build can produce, and the offer never
//! writes one at all.

import { WINDOW_BITS } from "./params";

/// A window the option asks for and this build can produce, or nothing.
///
/// A window of 15 is the only one libdeflate emits at any level, so a number at or above
/// it is already what the peer will get and saying so would be a promise about a
/// compressor that has one window. A number below it is honoured in the header and
/// handled by `params.ts`, which refuses the whole configuration rather than quietly
/// compressing with a different window than the one agreed.
export function narrowed(
  parameters: Record<string, string>,
  name: "server_max_window_bits" | "client_max_window_bits",
  option: number | false | undefined,
): void {
  if (typeof option !== "number" || option >= WINDOW_BITS) return;
  parameters[name] = String(option);
}
