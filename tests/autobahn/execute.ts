import { readFileSync } from "node:fs";
import { AUTOBAHN_IMAGE } from "./docker-args.ts";
import { exceedsInboundLimit } from "./expected-cases.ts";
import { parseReportIndex, toCaseReports } from "./report-index.ts";
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

/// Gates an existing report instead of running the suite.
///
/// The generation half of the harness needs the digest-pinned fuzzing client, which is
/// a frozen Python 2.7 image and so a Docker-capable host. The evaluation half needs
/// nothing at all: `evaluateGate` is a pure function of a case list, and this is the
/// whole of the rest. Treating "I have no Docker" as "I cannot check the gate" made a
/// local limitation look like a property of the protocol work, and it is the reason a
/// protocol fix could not ship with a regenerated baseline.
async function executeFromReport(options: RunOptions): Promise<AutobahnSummary> {
  const path = options.fromReport;
  if (path === undefined) throw new Error("autobahn: --from-report needs a path");
  let cases: ReturnType<typeof toCaseReports>;
  try {
    cases = toCaseReports(parseReportIndex(readFileSync(path, "utf8"), AGENT), exceedsInboundLimit);
  } catch (error) {
    return buildSummary({
      ok: false,
      mode: options.mode,
      agent: AGENT,
      image: AUTOBAHN_IMAGE,
      target: null,
      suiteRun: false,
      gate: null,
      cases: [],
      failure: `autobahn: ${(error as Error).message}`,
      shards: [],
    });
  }
  const gate = evaluateGate(cases, options.mode);
  return buildSummary({
    ok: gate.ok,
    mode: options.mode,
    agent: AGENT,
    image: AUTOBAHN_IMAGE,
    target: null,
    suiteRun: true,
    gate,
    cases,
    failure: null,
    shards: [],
  });
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
  // Gating a recorded report touches no container and no target, so it takes the other
  // branch: the signal handlers belong to modules that are not even loaded here.
  if (options.fromReport !== undefined) {
    const summary = await executeFromReport(options);
    writeSummary(SUMMARY_HOST_PATH, summary);
    process.stdout.write(`${formatSummary(summary)}\n`);
    return summary.ok ? 0 : 1;
  }
  // The target and container modules own the signal handlers, so an interrupted
  // run reaps every child and removes every container before this exits.
  const summary = await execute(options);
  writeSummary(SUMMARY_HOST_PATH, summary);
  process.stdout.write(`${formatSummary(summary)}\n`);
  return summary.ok ? 0 : 1;
}
