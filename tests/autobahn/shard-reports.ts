import { existsSync, readFileSync } from "node:fs";
import { AGENT, shardReportIndexPath } from "./paths.ts";
import { exceedsInboundLimit } from "./expected-cases.ts";
import { parseReportIndex, toCaseReports } from "./report-index.ts";
import type { CaseReport } from "./report-index.ts";
import type { Shard } from "./shard-plan.ts";

/// What one shard produced.
export type ShardResult = {
  readonly shard: Shard;
  readonly code: number;
  readonly cases: readonly CaseReport[];
};

/// Reads one shard's report.
///
/// A shard with no report is an empty list rather than a throw, so the union is
/// short and the gate's `count-total` names the loss. Throwing here would instead
/// fail the run on a stack trace that says nothing about which shard went missing.
export function readShardCases(id: number): readonly CaseReport[] {
  const path = shardReportIndexPath(id);
  if (!existsSync(path)) return [];
  return toCaseReports(parseReportIndex(readFileSync(path, "utf8"), AGENT), exceedsInboundLimit);
}

/// Concatenates the shards' case lists.
///
/// Deliberately a concatenation and not a merge by case id: the gate holds a run
/// to the total its mode selects, so a case an overlapping shard reports twice
/// surfaces as a `count-total` violation instead of being silently deduplicated
/// into a passing run. A shard that produced nothing therefore cannot pass
/// either, because the union is short.
export function unionCases(results: readonly ShardResult[]): readonly CaseReport[] {
  const union: CaseReport[] = [];
  for (const result of results) union.push(...result.cases);
  return union;
}

/// Case ids more than one shard reported, named so a `count-total` violation can
/// be traced to the plan rather than to the suite.
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

/// Shards that produced no report, so the failure names the shard rather than
/// only reporting a total that is short.
export function silentShards(results: readonly ShardResult[]): readonly number[] {
  return results.filter((result) => result.cases.length === 0).map((result) => result.shard.id);
}
