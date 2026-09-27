//! The compiled capacities, read from the addon rather than restated.
//!
//! Its own module because it is the one binding function that takes no handle: a
//! duplicate of any of these numbers in TypeScript is how a compiled limit and its
//! documented value drift apart, which already happened once with the message cap.

import type { NativeEngineLimits } from "./native";
import { loadAddon } from "./load";

export type { NativeEngineLimits };

/// The capacities a codec was compiled with, read rather than restated.
export function codecLimits(): NativeEngineLimits {
  return loadAddon().engineLimits();
}
