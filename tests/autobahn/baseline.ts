import baseline from "./baseline.json" with { type: "json" };

/// The known-failing case set. The engine has never passed this suite, so a gate demanding all
/// 389 cases would be red on arrival; a known-failure list still fails the moment a case
/// outside it fails, and reports any listed case that starts passing.
export type Baseline = {
  readonly size: number;
  readonly has: (id: string) => boolean;
  /// Baseline ids inside a set of case groups, for a run that selected a subset.
  idsInGroups: (groups: readonly string[]) => readonly string[];
  readonly groups: readonly {
    readonly group: string;
    readonly reason: string;
    readonly count: number;
  }[];
};

type BaselineGroup = {
  readonly reason: string;
  /// Space-separated case identifiers, one group per entry.
  readonly cases: string;
};

const GROUPS: Readonly<Record<string, BaselineGroup>> = baseline.groups;
const IDS: ReadonlySet<string> = new Set(
  Object.values(GROUPS).flatMap((group) => group.cases.split(" ")),
);

export const ALL_BASELINE_IDS: readonly string[] = [...IDS].sort();

/// A run that selects a subset must not treat the baseline entries it did not select as
/// stale: the deflate groups are absent by design in `framing` mode.
export function idsInGroups(groups: readonly string[]): readonly string[] {
  const wanted = new Set(groups);
  return [...IDS].filter((id) => wanted.has(id.split(".")[0])).sort();
}

export const KNOWN_FAILURES: Baseline = {
  size: IDS.size,
  has: (id: string): boolean => IDS.has(id),
  idsInGroups,
  groups: Object.entries(GROUPS)
    .map(([group, value]) => ({
      group,
      reason: value.reason,
      count: value.cases.split(" ").length,
    }))
    .sort((left, right) => left.group.localeCompare(right.group)),
};

import type { ModeCounts } from "./expected-cases.ts";
import type { CaseReport } from "./report-index.ts";
import { isTolerated } from "./report-index.ts";

export type BaselineDrift = {
  /// Baseline entries the run did not reproduce; a case can drop out between two runs.
  readonly stale: readonly string[];
  /// Baseline entries the run now passes: the work queue, reported so a finished case cannot
  /// be left behind in `baseline.json`.
  readonly fixed: readonly string[];
};

/// Compares the committed known-failure list against a run, in both directions. Only a failure
/// outside the list is fatal; an entry that now passes is reported rather than ignored, so the
/// list shrinks as the engine improves and nobody can leave a finished case sitting in it.
export function baselineDrift(cases: readonly CaseReport[], mode: ModeCounts): BaselineDrift {
  const stale: string[] = [];
  const fixed: string[] = [];
  const selected = idsInGroups(mode.groups);
  const seen = new Set<string>();
  for (const entry of cases) {
    if (!KNOWN_FAILURES.has(entry.id)) continue;
    seen.add(entry.id);
    if (entry.outcome === "skipped-capacity") continue;
    if (isTolerated(entry.behavior) && isTolerated(entry.behaviorClose)) fixed.push(entry.id);
  }
  for (const id of selected) {
    if (!seen.has(id)) stale.push(id);
  }
  return { stale: stale.sort(), fixed: fixed.sort() };
}
