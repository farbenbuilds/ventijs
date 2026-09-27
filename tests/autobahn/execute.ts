import { AUTOBAHN_IMAGE } from "./docker-args.ts";
import { AGENT, DEFAULT_TARGET_HOST, SUMMARY_HOST_PATH } from "./paths.ts";
import { evaluateGate } from "./gate.ts";
import { buildSummary, formatSummary, writeSummary } from "./summary.ts";
import type { AutobahnSummary } from "./summary.ts";
import { planShards } from "./shard-plan.ts";
import { resetReportDirectory } from "./suite.ts";
import { blockedByProbe, probeOf, runShardedFor, runSingleFor } from "./suite-execution.ts";
import type { Execution } from "./suite-execution.ts";
import { startTargets, stopTargets } from "./target-process.ts";
import type { TargetProcess } from "./target-process.ts";
import type { RunOptions } from "./run-options.ts";
import { USAGE, parseOptions } from "./run-options.ts";

const IDLE: Execution = { probe: null, suiteRun: false, cases: [], failure: null };

/// Every target is up before any container starts, so a target that cannot bind
/// fails in seconds instead of after a suite has measured timeouts against it.
async function execute(options: RunOptions): Promise<AutobahnSummary> {
  resetReportDirectory();
  const shards = planShards(options.shards, options.mode);
  let targets: readonly TargetProcess[] = [];
  let execution: Execution = IDLE;
  try {
    targets = await startTargets(
      shards.map((shard) => ({ port: shard.port, host: DEFAULT_TARGET_HOST })),
    );
    execution = await measure(options, shards, targets);
  } catch (error) {
    execution = { ...execution, failure: (error as Error).message };
  }
  await stopTargets(targets);
  const gate = execution.cases.length === 0 ? null : evaluateGate(execution.cases, options.mode);
  return buildSummary({
    ok: execution.failure === null && gate !== null && gate.ok,
    mode: options.mode,
    agent: AGENT,
    image: AUTOBAHN_IMAGE,
    target: execution.probe,
    suiteRun: execution.suiteRun,
    gate,
    cases: execution.cases,
    failure: execution.failure,
    shards,
  });
}

async function measure(
  options: RunOptions,
  shards: ReturnType<typeof planShards>,
  targets: readonly TargetProcess[],
): Promise<Execution> {
  const first = targets[0];
  if (first === undefined) return { ...IDLE, failure: "autobahn: no target started" };
  const probe = await probeOf(first);
  const blocked = blockedByProbe(probe, first.ready.port, options.force);
  if (blocked !== null) return blocked;
  const execution =
    options.shards === 1
      ? await runSingleFor(options.mode, first)
      : await runShardedFor(shards, targets);
  return { ...execution, probe };
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: RunOptions;
  try {
    options = parseOptions(argv);
  } catch (error) {
    process.stderr.write(`autobahn: ${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  // The target and container modules own the signal handlers, so an interrupted
  // run reaps every child and removes every container before this exits.
  const summary = await execute(options);
  writeSummary(SUMMARY_HOST_PATH, summary);
  process.stdout.write(`${formatSummary(summary)}\n`);
  return summary.ok ? 0 : 1;
}
