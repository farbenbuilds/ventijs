import { BASELINE_ID, CANDIDATE_ID } from "../echo/echo-types.ts";
import { GATE_MIN_RATIO } from "./options.ts";
import type { ConfigurationResult } from "./summary.ts";

export type GateVerdict = {
  readonly failed: boolean;
  readonly lines: readonly string[];
};

/// Only the gate pair can decide the verdict; a reference leg that is slow or
/// unavailable never fails the gate, and a gate leg with no number counts as a
/// failure rather than a skip.
const evaluate = (result: ConfigurationResult): string => {
  const baseline = result.legs[BASELINE_ID];
  const candidate = result.legs[CANDIDATE_ID];
  if (baseline.medianRoundTripsPerSecond === null) {
    return `unverified  ${result.configuration}: no ${BASELINE_ID} baseline (${baseline.reason})`;
  }
  if (candidate.medianRoundTripsPerSecond === null) {
    return `unverified  ${result.configuration}: no ${CANDIDATE_ID} number (${candidate.reason})`;
  }
  const ratio = candidate.medianRoundTripsPerSecond / baseline.medianRoundTripsPerSecond;
  if (ratio >= GATE_MIN_RATIO) {
    return `pass        ${result.configuration}: ${ratio.toFixed(3)} of ${BASELINE_ID}`;
  }
  return `FAIL        ${result.configuration}: ${ratio.toFixed(3)} of ${BASELINE_ID} is below ${GATE_MIN_RATIO}`;
};

/// A configuration the harness could not measure is not a pass. A gate that
/// only fires on a measured regression would report success on a run that
/// measured nothing at all.
export const evaluateGate = (results: readonly ConfigurationResult[]): GateVerdict => {
  const lines = results.map(evaluate);
  return { failed: lines.some((line) => !line.startsWith("pass")), lines };
};
