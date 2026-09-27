import {
  CAPACITY_CASES,
  COMPRESSION_CASES,
  EVALUATED_CASES,
  SCALAR_CAPACITY_CASES,
  TOTAL_CASES,
} from "./expected-cases.ts";

/// How much of the suite a run selects, and the counts the gate holds it to.
///
/// `framing` drops the two per-message-deflate groups. They are 216 of 517 cases
/// and every one is `UNIMPLEMENTED` because `permessage-deflate` is normalised and
/// never negotiated, so they cannot change until deflate is implemented.
///
/// It is not a speedup, which was the assumption when it was added. Two runs of
/// the same job: `full` took 2100s of suite time for 517 cases, `framing` took
/// 2086s for 301. The cost is not per case, because a deflate case whose
/// extension is never negotiated fails almost immediately while the framing and
/// UTF-8 groups are where the client actually waits. The cost is concentrated in
/// the groups this mode keeps.
///
/// It is kept because it is the same signal for marginally less work, because
/// the report then states what it covered, and because it will start costing real
/// time the moment deflate is implemented and the groups have to come back.
export type SuiteMode = "framing" | "full";

export type ModeCounts = {
  readonly mode: SuiteMode;
  readonly total: number;
  readonly capacity: number;
  readonly evaluated: number;
  /// Baseline groups this mode selects, for the drift check.
  readonly groups: readonly string[];
};

/// The counts a run is held to, per selection.
const FRAMING_TOTAL = TOTAL_CASES - COMPRESSION_CASES;
const FRAMING_CAPACITY = SCALAR_CAPACITY_CASES;

export const MODE_COUNTS: Readonly<Record<SuiteMode, ModeCounts>> = {
  framing: {
    mode: "framing",
    total: FRAMING_TOTAL,
    capacity: FRAMING_CAPACITY,
    evaluated: FRAMING_TOTAL - FRAMING_CAPACITY,
    groups: ["1", "2", "3", "4", "5", "6", "7", "9", "10", "11"],
  },
  full: {
    mode: "full",
    total: TOTAL_CASES,
    capacity: CAPACITY_CASES,
    evaluated: EVALUATED_CASES,
    groups: ["1", "2", "3", "4", "5", "6", "7", "9", "10", "11", "12", "13"],
  },
};
