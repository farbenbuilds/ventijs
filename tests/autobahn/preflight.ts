import { loadVentiwsAddon } from "./addon.ts";
import { weightTableIsConsistent } from "./shard-plan.ts";

/// Loads the native addon, checks the shard weight table against the totals the gate already
/// asserts, and prints the plan, then exits.
///
/// Two failures, both otherwise found after a full sharded suite: an addon that cannot be
/// `dlopen` at all, and a weight table that has drifted from the case counts.
const addon = loadVentiwsAddon();
if (!weightTableIsConsistent()) {
  process.stderr.write(
    "autobahn-preflight: tests/autobahn/shard-weights.json does not agree with the " +
      "case totals in expected-cases.ts; the shard split would be silently wrong\n",
  );
  process.exit(1);
}
process.stdout.write(
  `ventiws-preflight engine ${addon.engineVersion()} http3 ${String(addon.http3Available())}\n`,
);
