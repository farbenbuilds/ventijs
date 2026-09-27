import { loadVentijsAddon } from "./addon.ts";
import { weightTableIsConsistent } from "./shard-plan.ts";

/// Loads the native addon, checks the shard weight table against the totals the
/// gate already asserts, and prints the plan, then exits.
///
/// Two failures, both of which would otherwise be discovered after a full sharded
/// suite: an addon that cannot be `dlopen` at all, and a weight table that has
/// drifted away from the case counts so the split is silently wrong. The first
/// costs five seconds instead of one; the second costs a mis-measured suite run.
const addon = loadVentijsAddon();
if (!weightTableIsConsistent()) {
  process.stderr.write(
    "autobahn-preflight: tests/autobahn/shard-weights.json does not agree with the " +
      "case totals in expected-cases.ts; the shard split would be silently wrong\n",
  );
  process.exit(1);
}
process.stdout.write(
  `ventijs-preflight engine ${addon.engineVersion()} http3 ${String(addon.http3Available())}\n`,
);
