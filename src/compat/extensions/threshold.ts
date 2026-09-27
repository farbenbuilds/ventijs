//! Reading a threshold out of a `perMessageDeflate` option.
//!
//! Split out of the send path because the send path asks the question once per frame and
//! the answer cannot change, so the socket carries a number and not the option. A socket
//! with the extension off never asks, which is why a disabled option is a zero threshold
//! here rather than a separate case at the call site.

import { DEFAULT_THRESHOLD } from "../options/shared";
import type { NormalizedPerMessageDeflate } from "../../types/options";

/// The smallest payload worth compressing, or 0 when compression is off.
///
/// `ws` compares `byteLength >= threshold`, so a threshold of 0 compresses every message
/// and a threshold above the payload does not compress any. Both are reachable, so the
/// comparison at the call site is `>=` and this value is never clamped.
export function thresholdOf(options: NormalizedPerMessageDeflate | false): number {
  if (options === false) return 0;
  return options.threshold;
}

/// The `ws` default, exported for the option normalizer and for a test that has to state
/// the number rather than read it.
export const DEFAULT_PERMESSAGE_DEFLATE_THRESHOLD = DEFAULT_THRESHOLD;
