import { planShards, weightTableIsConsistent } from "./shard-plan.ts";
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

for (const mode of ["framing", "full"] as const) describe(mode as SuiteMode);

function describe(mode: SuiteMode): void {
  const plan = planShards(shardCount(), mode);
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

function shardCount(): number {
  const raw = process.env["AUTOBAHN_SHARDS"] ?? "4";
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4;
}
