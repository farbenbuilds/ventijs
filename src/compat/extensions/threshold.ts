/// Reading a threshold out of a `perMessageDeflate` option. The send path asks once per
/// frame and the answer cannot change, so the socket carries a number and not the option.

import { DEFAULT_THRESHOLD } from "../options/shared";
import type { NormalizedPerMessageDeflate } from "../../types/options";

/// `ws` compares `byteLength >= threshold`, so 0 compresses every message and a threshold
/// above the payload compresses none. Both are reachable, so the comparison at the call
/// site is `>=` and this value is never clamped.
export function thresholdOf(options: NormalizedPerMessageDeflate | false): number {
  if (options === false) return 0;
  return options.threshold;
}

export const DEFAULT_PERMESSAGE_DEFLATE_THRESHOLD = DEFAULT_THRESHOLD;
