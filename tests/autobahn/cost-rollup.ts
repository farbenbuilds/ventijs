import type { CaseReport } from "./report-index.ts";

/// Measured suite cost, rolled up per group.
///
/// Every run already writes a per-case `duration` into the report and this file
/// previously discarded it, so there has never been a way to answer "which group
/// is the job actually spending its time in" from a single artifact. That is the
/// number the shard plan's weight table is a guess at, so publishing it turns the
/// guess into a measurement and makes the split tunable from data rather than
/// from a derivation.
export type GroupCost = {
  readonly group: string;
  readonly cases: number;
  readonly seconds: number;
  /// Mean per-case cost, the quantity that is genuinely uniform across the
  /// framing groups and is not across the deflate ones.
  readonly secondsPerCase: number;
};

export type CostRollup = {
  readonly groups: readonly GroupCost[];
  readonly totalSeconds: number;
  /// The cases that dominate the run. A single pathological case is the usual
  /// explanation for a suite that got slower without changing.
  readonly slowest: readonly CaseReport[];
};

const SLOWEST_COUNT = 5;

function emptyCost(group: string): GroupCost {
  return { group, cases: 0, seconds: 0, secondsPerCase: 0 };
}

export function rollupCosts(cases: readonly CaseReport[]): CostRollup {
  const byGroup = new Map<string, { cases: number; milliseconds: number }>();
  for (const entry of cases) {
    const group = entry.id.split(".")[0] ?? entry.id;
    const bucket = byGroup.get(group) ?? { cases: 0, milliseconds: 0 };
    bucket.cases += 1;
    bucket.milliseconds += entry.durationMs;
    byGroup.set(group, bucket);
  }
  const groups = [...byGroup.entries()]
    .map(([group, bucket]) => {
      const seconds = bucket.milliseconds / 1000;
      const base = emptyCost(group);
      return {
        group,
        cases: bucket.cases,
        seconds,
        secondsPerCase: bucket.cases === 0 ? base.secondsPerCase : seconds / bucket.cases,
      };
    })
    .sort((left, right) => right.seconds - left.seconds);
  const slowest = [...cases]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, SLOWEST_COUNT);
  return {
    groups,
    totalSeconds: groups.reduce((total, entry) => total + entry.seconds, 0),
    slowest,
  };
}

/// One line per group, heaviest first, for the run summary.
export function formatCostRollup(rollup: CostRollup): readonly string[] {
  const lines: string[] = [];
  for (const entry of rollup.groups) {
    const share = rollup.totalSeconds === 0 ? 0 : (100 * entry.seconds) / rollup.totalSeconds;
    lines.push(
      `  group ${entry.group.padEnd(3)} ${String(entry.cases).padStart(4)} cases ` +
        `${entry.seconds.toFixed(1).padStart(8)}s ` +
        `${`${share.toFixed(1)}%`.padStart(6)} ` +
        `${entry.secondsPerCase.toFixed(2)}s/case`,
    );
  }
  return lines;
}
