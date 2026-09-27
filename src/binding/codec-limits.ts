import type { NativeEngineLimits } from "./native-limits";
import { loadAddon } from "./load";

/// The ceilings the linked addon was compiled with, and the defaults a codec gets
/// when an option was not set.
///
/// The compiled ceiling and the default are different numbers and both are here.
/// The default is `ws`'s, so a caller that reads this to find out what a codec with
/// no options enforces gets the answer a `WebSocketServer` with no options gets. The
/// ceiling is the boundary's own limit, so a caller that wants more than `ws` offers
/// can find out how much more is possible before asking for it.
export function codecLimits(): NativeEngineLimits {
  return loadAddon().engineLimits();
}
