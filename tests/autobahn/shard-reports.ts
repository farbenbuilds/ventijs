import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { AGENT, shardReportIndexPath, shardReportsDir, shardSpecPath } from "./paths.ts";
import { removeContainer } from "./docker.ts";
import { exceedsInboundLimit } from "./expected-cases.ts";
import { parseReportIndex, toCaseReports } from "./report-index.ts";
import type { CaseReport } from "./report-index.ts";
import { shardContainerName, shardSpec, writeShardSpec } from "./shard-plan.ts";
import type { Shard } from "./shard-plan.ts";
import { runContainer } from "./suite.ts";

export type ShardResult = {
  readonly shard: Shard;
  readonly code: number;
  readonly cases: readonly CaseReport[];
};

/// A shard with no report is an empty list rather than a throw, so the gate's `count-total`
/// names the loss instead of a stack trace that says nothing about which shard went missing.
export function readShardCases(id: number): readonly CaseReport[] {
  const path = shardReportIndexPath(id);
  if (!existsSync(path)) return [];
  return toCaseReports(parseReportIndex(readFileSync(path, "utf8"), AGENT), exceedsInboundLimit);
}

/// Deliberately a concatenation and not a merge by id: the gate holds a run to its mode's total,
/// so an overlapping case surfaces as a `count-total` violation, not a silent dedupe.
export function unionCases(results: readonly ShardResult[]): readonly CaseReport[] {
  const union: CaseReport[] = [];
  for (const result of results) union.push(...result.cases);
  return union;
}

/// Named so a `count-total` violation can be traced to the plan rather than the suite.
export function duplicateCaseIds(results: readonly ShardResult[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const result of results) {
    for (const entry of result.cases) {
      if (seen.has(entry.id)) duplicates.add(entry.id);
      seen.add(entry.id);
    }
  }
  return [...duplicates].sort();
}

/// Shards that produced no report, so the failure names the shard and not only a short total.
export function silentShards(results: readonly ShardResult[]): readonly number[] {
  return results.filter((result) => result.cases.length === 0).map((result) => result.shard.id);
}

/// Writes each shard's `fuzzingclient.json` before anything is started.
///
/// The pinned `wstest` exposes no case-selection flag but `-s`, and the suite runs one server
/// at a time, so N concurrent shards need N spec files; generating them keeps the union
/// checkable by the gate instead of leaving N committed configurations to fall out of sync.
function prepare(shard: Shard): void {
  mkdirSync(shardReportsDir(shard.id), { recursive: true });
  writeShardSpec(shardSpecPath(shard.id), shardSpec(shard));
}

/// Runs every shard's fuzzing client concurrently and collects what each wrote.
///
/// All containers are force-removed before this returns, on every path, so a cancelled or
/// failed run cannot leave one holding a report directory. The streams are inherited rather
/// than prefixed, which is what sharding gives up: N Python tracebacks interleave in one log.
export async function runShards(shards: readonly Shard[]): Promise<readonly ShardResult[]> {
  for (const shard of shards) prepare(shard);
  // Settled, not raced: a shard whose report will not parse must not discard the other
  // shards' evidence, so a rejected read becomes a failed shard the failure message names.
  const settled = await Promise.allSettled(
    shards.map(async (shard) => {
      const name = shardContainerName(shard.id);
      try {
        const code = await runContainer({
          configHostPath: shardSpecPath(shard.id),
          reportsHostDir: shardReportsDir(shard.id),
          name,
        });
        return { shard, code, cases: readShardCases(shard.id) };
      } finally {
        removeContainer(name);
      }
    }),
  );
  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const shard = shards[index];
    process.stderr.write(
      `autobahn: shard ${shard.id} report unreadable: ${String(entry.reason)}\n`,
    );
    return { shard, code: 127, cases: [] };
  });
}
