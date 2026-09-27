import { baselineDrift } from "./baseline-drift.ts";
import { KNOWN_FAILURES } from "./baseline.ts";
import { MODE_COUNTS } from "./suite-mode.ts";
import type { SuiteMode } from "./suite-mode.ts";
import { closeBehaviorViolations, countOutcomes, countViolations } from "./gate-counts.ts";
import type { CaseReport } from "./report-index.ts";
import { isTolerated } from "./report-index.ts";

export type ViolationKind =
  | "case-regressed"
  | "case-fixed"
  | "baseline-stale"
  | "closure-unknown"
  | "count-capacity"
  | "count-evaluated"
  | "count-total";

export type Violation = {
  readonly kind: ViolationKind;
  readonly detail: string;
};

export type GateCounts = {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly capacity: number;
  readonly nonStrict: number;
  readonly closureOk: number;
  readonly closureInformational: number;
};

export type GateResult = {
  readonly ok: boolean;
  readonly mode: SuiteMode;
  readonly counts: GateCounts;
  readonly violations: readonly Violation[];
  /// Baseline entries the run did not reproduce. A case can drop out of the
  /// suite between two runs, which is not a regression, so this is reported and
  /// the list entry should be dropped from `baseline.json`.
  readonly staleBaseline: readonly string[];
  /// Baseline entries the run now passes. This is the work queue, reported so a
  /// finished case cannot be left behind in `baseline.json`.
  readonly fixed: readonly string[];
};

/// A failure the baseline already accounts for is the project's current state, not
/// a regression. Anything else is new and fails the run.
function caseViolations(cases: readonly CaseReport[]): readonly Violation[] {
  const violations: Violation[] = [];
  for (const entry of cases) {
    if (entry.outcome === "skipped-capacity") continue;
    if (isTolerated(entry.behavior) && isTolerated(entry.behaviorClose)) continue;
    if (KNOWN_FAILURES.has(entry.id)) continue;
    violations.push({
      kind: "case-regressed",
      detail: `${entry.id} behavior=${entry.behavior} behaviorClose=${entry.behaviorClose}`,
    });
  }
  return violations;
}

function driftViolations(drift: {
  readonly stale: readonly string[];
  readonly fixed: readonly string[];
}): readonly Violation[] {
  return [
    ...drift.fixed.map((id) => ({
      kind: "case-fixed" as const,
      detail: `${id} now passes; remove it from tests/autobahn/baseline.json`,
    })),
    ...drift.stale.map((id) => ({
      kind: "baseline-stale" as const,
      detail: `${id} is in the baseline but the report has no such case`,
    })),
  ];
}

export function evaluateGate(cases: readonly CaseReport[], mode: SuiteMode = "full"): GateResult {
  const counts = countOutcomes(cases);
  const drift = baselineDrift(cases, MODE_COUNTS[mode]);
  const violations = [
    ...countViolations(counts, mode),
    ...closeBehaviorViolations(cases),
    ...caseViolations(cases),
    ...driftViolations(drift),
  ];
  return {
    ok: violations.length === 0,
    mode,
    counts,
    violations,
    staleBaseline: drift.stale,
    fixed: drift.fixed,
  };
}
