import {
  CAPACITY_CASES,
  COMPRESSION_CASES,
  EVALUATED_CASES,
  SCALAR_CAPACITY_CASES,
  TOTAL_CASES,
} from "./expected-cases.ts";

/// How much of the suite a run selects, and the counts the gate holds it to. `framing` drops
/// the two per-message-deflate groups, 216 of 517 cases, because they are the slow ones
/// and the compression wiring is on a separate change record. It is not much of a speedup:
/// a per-case cost that is a near-constant inside the client makes the two selections
/// cost about the same. What it buys is a report that says what it covered.
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
