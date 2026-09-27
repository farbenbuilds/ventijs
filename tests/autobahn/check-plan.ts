import {
  DEFAULT_SHARD_COUNT,
  planShards,
  resolveShardCount,
  weightTableIsConsistent,
} from "./shard-plan.ts";
import type { SuiteMode } from "./suite-mode.ts";

/// Prints the shard plan for both selections and exits non-zero if the committed
/// weight table no longer agrees with the case totals the gate asserts.
///
/// It exists because the weights are a derivation and a derivation can rot. This
/// fails in seconds in a step that costs nothing, instead of quietly rebalancing
/// the split during a suite run and costing the whole run.
if (!weightTableIsConsistent()) {
  process.stderr.write(
    "autobahn-plan: tests/autobahn/shard-weights.json does not agree with the case " +
      "totals in expected-cases.ts; re-derive the weights from a run's summary.json\n",
  );
  process.exit(1);
}

for (const mode of ["framing", "full"] as const) describe(mode);

function describe(mode: SuiteMode): void {
  // The same resolver the runner uses, so this step approves exactly the
  // configurations the suite can actually run and fails the rest here rather
  // than letting the suite reject them mid-run.
  const plan = planShards(shardCount(mode), mode);
  const critical = Math.max(...plan.map((shard) => shard.costSeconds));
  const lines = [
    `${mode}: ${plan.length} shards, critical path ${critical.toFixed(0)}s`,
    ...plan.map(
      (shard) =>
        `  shard ${shard.id} port ${shard.port} groups ${shard.groups.join(" ")} ` +
        `${shard.costSeconds.toFixed(0)}s`,
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function shardCount(mode: SuiteMode): number {
  const raw = process.env["AUTOBAHN_SHARDS"];
  if (raw === undefined || raw === "") return DEFAULT_SHARD_COUNT;
  return resolveShardCount(raw, mode);
}
