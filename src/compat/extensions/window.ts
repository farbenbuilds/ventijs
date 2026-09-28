/// A rule about the *compressor*, not about either direction: the answer writes a window only
/// when the option asks for one this build can produce, and the offer never writes one at all.

import { WINDOW_BITS } from "./params";

/// 15 is the only window libdeflate emits at any level, so a number at or above it is already
/// what the peer will get. A number below it is honoured in the header, and `params.ts` refuses
/// the whole configuration rather than compressing with a different window than the one agreed.
export function narrowed(
  parameters: Record<string, string>,
  name: "server_max_window_bits" | "client_max_window_bits",
  option: number | false | undefined,
): void {
  if (typeof option !== "number" || option >= WINDOW_BITS) return;
  parameters[name] = String(option);
}
