import { loadVentiwsAddon } from "./target-runtime.ts";

/// Loads the native addon and prints what it is, so a runtime that cannot dlopen the
/// artifact fails in seconds instead of after a full sharded suite.
const addon = loadVentiwsAddon();
process.stdout.write(
  `ventiws-preflight engine ${addon.engineVersion()} http3 ${String(addon.http3Available())}\n`,
);
