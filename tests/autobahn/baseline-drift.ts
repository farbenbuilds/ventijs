import { idsInGroups, KNOWN_FAILURES } from "./baseline.ts";
import type { ModeCounts } from "./suite-mode.ts";
import type { CaseReport } from "./report-index.ts";
import { isTolerated } from "./report-index.ts";

export type BaselineDrift = {
  /// Baseline entries the run did not reproduce. A case can drop out of the
  /// suite between two runs, and that is not a regression.
  readonly stale: readonly string[];
  /// Baseline entries the run now passes. These are the work queue, and they
  /// are reported so a fix cannot be left behind in `baseline.json`.
  readonly fixed: readonly string[];
};

/// Compares the committed known-failure list against a run, in both directions.
///
/// Only a failure outside the list is fatal. A list entry that now passes is
/// reported rather than ignored, so the list shrinks as the engine improves and
/// nobody can leave a finished case sitting in it.
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
