import { describe, expect, it } from "vitest";
import { evaluateGate } from "../autobahn/gate.ts";
import { MODE_COUNTS } from "../autobahn/suite-mode.ts";
import { planShards } from "../autobahn/shard-plan.ts";
import { duplicateCaseIds, silentShards, unionCases } from "../autobahn/shard-reports.ts";
import type { ShardResult } from "../autobahn/shard-reports.ts";
import type { CaseReport } from "../autobahn/report-index.ts";
import { formatCostRollup, rollupCosts } from "../autobahn/cost-rollup.ts";

function caseReport(
  id: string,
  durationMs = 0,
  outcome: CaseReport["outcome"] = "passed",
): CaseReport {
  return { id, behavior: "OK", behaviorClose: "OK", durationMs, remoteCloseCode: 1000, outcome };
}

/// Synthesises the case ids a plan covers, so the union can be checked against
/// the gate's count contract without a suite run.
function casesForGroups(groups: readonly string[], perGroup: number): readonly CaseReport[] {
  const cases: CaseReport[] = [];
  for (const group of groups) {
    for (let index = 1; index <= perGroup; index += 1) {
      cases.push(caseReport(`${group}.${index}.1`));
    }
  }
  return cases;
}

function shardResult(shardId: number, cases: readonly CaseReport[], code = 0): ShardResult {
  return { shard: planShards(4, "framing")[shardId], code, cases };
}

describe("shard union", () => {
  it("concatenates without deduplicating, so an overlap trips the count gate", () => {
    const shard = planShards(4, "framing")[0];
    const shared = [caseReport("6.1.1")];
    const results: readonly ShardResult[] = [
      { shard, code: 0, cases: shared },
      { shard, code: 0, cases: shared },
    ];
    expect(unionCases(results)).toHaveLength(2);
    expect(duplicateCaseIds(results)).toEqual(["6.1.1"]);
  });

  it("reports the union as short when a shard produced nothing", () => {
    const results = [shardResult(0, [caseReport("1.1.1")]), shardResult(1, [])];
    expect(unionCases(results)).toHaveLength(1);
    expect(silentShards(results)).toEqual([1]);
  });

  it("names every shard when the whole run produced nothing", () => {
    const results = [
      shardResult(0, []),
      shardResult(1, []),
      shardResult(2, []),
      shardResult(3, []),
    ];
    expect(silentShards(results)).toEqual([0, 1, 2, 3]);
  });

  it("reports no duplicates when the shards partition the mode cleanly", () => {
    const plan = planShards(4, "framing");
    const results = plan.map((shard) => ({
      shard,
      code: 0,
      cases: casesForGroups(shard.groups, 2),
    }));
    expect(duplicateCaseIds(results)).toEqual([]);
    expect(silentShards(results)).toEqual([]);
    expect(unionCases(results)).toHaveLength(MODE_COUNTS.framing.groups.length * 2);
  });
});

describe("the gate over a union", () => {
  it("fails on a union that is short of the mode total", () => {
    // A shard that silently contributed nothing must not be able to pass: the
    // expectation comes from the mode, never from what the reports happen to
    // contain, so a missing case is a `count-total` violation.
    const plan = planShards(4, "framing");
    const complete = plan.map((shard) => ({
      shard,
      code: 0,
      cases: casesForGroups(shard.groups, 2),
    }));
    const short = complete.slice(0, 3);
    const gate = evaluateGate(unionCases(short), "framing");
    expect(gate.ok).toBe(false);
    expect(gate.violations.map((violation) => violation.kind)).toContain("count-total");
  });

  it("fails an empty union on the count, naming the total it expected", () => {
    const gate = evaluateGate([], "framing");
    expect(gate.ok).toBe(false);
    const violation = gate.violations.find((entry) => entry.kind === "count-total");
    expect(violation?.detail).toContain(String(MODE_COUNTS.framing.total));
  });
});

describe("cost rollup", () => {
  it("sums durations per group, heaviest first", () => {
    const rollup = rollupCosts([
      caseReport("6.1.1", 1000),
      caseReport("6.2.1", 1000),
      caseReport("9.1.1", 9000),
      caseReport("12.1.1", 10),
    ]);
    expect(rollup.groups.map((entry) => entry.group)).toEqual(["9", "6", "12"]);
    expect(rollup.groups[0].cases).toBe(1);
    expect(rollup.groups[1].secondsPerCase).toBe(1);
    expect(rollup.totalSeconds).toBeCloseTo(11.01, 5);
  });

  it("lists the slowest cases, which is how a pathological one is found", () => {
    const rollup = rollupCosts([
      caseReport("6.1.1", 10),
      caseReport("9.3.1", 50_000),
      caseReport("9.4.1", 20_000),
    ]);
    expect(rollup.slowest[0].id).toBe("9.3.1");
  });

  it("renders a share and a per-case mean for each group", () => {
    const lines = formatCostRollup(
      rollupCosts([caseReport("6.1.1", 2000), caseReport("9.1.1", 2000)]),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("50.0%");
    expect(lines[0]).toContain("2.00s/case");
  });

  it("is empty rather than throwing when the suite never ran", () => {
    const rollup = rollupCosts([]);
    expect(rollup.groups).toEqual([]);
    expect(rollup.totalSeconds).toBe(0);
    expect(formatCostRollup(rollup)).toEqual([]);
  });
});
