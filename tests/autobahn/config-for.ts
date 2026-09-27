import { CONFIG_FRAMING_HOST_PATH, CONFIG_HOST_PATH } from "./paths.ts";
import type { SuiteMode } from "./suite-mode.ts";

/// The config a mode selects. The container always mounts it at the same path,
/// so only the host side of the bind changes.
export function configFor(mode: SuiteMode): string {
  return mode === "framing" ? CONFIG_FRAMING_HOST_PATH : CONFIG_HOST_PATH;
}
