import type { NativeEngineLimits } from "./native-limits";
import { loadAddon } from "./load";

/// The compiled ceiling and the default are different numbers and both are here. The
/// default is `ws`'s, so a caller reading this for what a codec with no options
/// enforces gets what a `WebSocketServer` with no options gets.
export function codecLimits(): NativeEngineLimits {
  return loadAddon().engineLimits();
}
