/// The pinned suite contract: case totals, the closure vocabulary, the cases a
/// selection covers, and which cases the compiled cap blocks.
///
/// The blocked set is pinned per case rather than derived from per-case payload
/// sizes. The derivation re-priced itself when `INBOUND_LIMIT_BYTES` moved, but it
/// needed a size table per group to answer the same question, and the answer only
/// moves when the cap moves, which re-records the baseline anyway.

import { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";

export { INBOUND_LIMIT_BYTES };

export const CLOSURE_BEHAVIORS: ReadonlySet<string> = new Set([
  "OK",
  "INFORMATIONAL",
  "NON-STRICT",
  "UNIMPLEMENTED",
  "FAILED",
  "WRONG CODE",
  "UNCLEAN",
  "INCOMPLETE",
  "DECODE ERROR",
]);

/// How much of the suite a run selects, and the counts the gate holds it to.
export type SuiteMode = "framing" | "full";

export type ModeCounts = {
  readonly mode: SuiteMode;
  readonly total: number;
  readonly capacity: number;
  readonly evaluated: number;
  /// Baseline groups this mode selects, for the drift check.
  readonly groups: readonly string[];
};

/// 517 total; the two per-message-deflate groups are 216 of them.
export const TOTAL_CASES = 517;
export const COMPRESSION_CASES = 216;

/// The predicate below is pinned at the compiled cap. A build whose cap moved must
/// move the blocked sub-ids with it, so it fails here instead of silently
/// reclassifying cases the suite can now reach.
if (INBOUND_LIMIT_BYTES !== 65_536) {
  throw new Error(
    `autobahn: INBOUND_LIMIT_BYTES is ${INBOUND_LIMIT_BYTES}, but the capacity predicate in ` +
      "expected-cases.ts is pinned at 65536; update it and re-record the baseline together",
  );
}

/// Group 9 walks DATALEN per case and 7.1.6 is one 256 KiB payload; 10.1.1 is one
/// 64 KiB payload, exactly at the cap, so it is evaluated rather than blocked.
const BLOCKED_7_1_6 = ["7.1.6", "7.1.6.1"];
const NINE_SUB_IDS: Readonly<Record<string, readonly number[]>> = {
  "1": [4, 5, 6],
  "2": [4, 5, 6],
  "3": [2, 3, 4, 5, 6, 7, 8, 9],
  "4": [2, 3, 4, 5, 6, 7, 8, 9],
  "5": [2, 3, 4, 5, 6],
  "6": [2, 3, 4, 5, 6],
};

/// The deflate MSG_SIZES rows above the cap, shared by all twelve parameter sets.
const COMPRESSION_OVER_LIMIT_ROWS = [10, 15, 16, 17, 18] as const;

/// Group 12's dataset 4 is `data1.html`, and the suite slices its decoded string
/// by code points: the 65536-code-point row encodes to up to 65563 UTF-8 bytes,
/// above the compiled cap. The JSON datasets are ASCII, land exactly on the cap,
/// and fit, so only these two rows are blocked; a run confirmed both.
const COMPRESSION_OVER_LIMIT_CASES = ["12.4.9", "12.4.14"] as const;

export function exceedsInboundLimit(caseId: string): boolean {
  if (BLOCKED_7_1_6.includes(caseId)) return true;
  if ((COMPRESSION_OVER_LIMIT_CASES as readonly string[]).includes(caseId)) return true;
  const parts = caseId.split(".");
  if (parts[0] === "9" && parts.length >= 3) {
    const sub = Number(parts.slice(2).join("."));
    return Number.isInteger(sub) && (NINE_SUB_IDS[parts[1]] ?? []).includes(sub);
  }
  if (parts.length === 3 && (parts[0] === "12" || parts[0] === "13")) {
    return (COMPRESSION_OVER_LIMIT_ROWS as readonly number[]).includes(Number(parts[2]));
  }
  return false;
}

/// Counted per case: 7.1.6 plus the listed group-9 sub-ids.
export const SCALAR_CAPACITY_CASES =
  1 + Object.values(NINE_SUB_IDS).reduce((total, subIds) => total + subIds.length, 0);
/// Five group-12 and seven group-13 parameter sets, each with five over-limit rows,
/// plus the two UTF-8-expanded group-12 rows above.
export const COMPRESSION_CAPACITY_CASES =
  12 * COMPRESSION_OVER_LIMIT_ROWS.length + COMPRESSION_OVER_LIMIT_CASES.length;
export const CAPACITY_CASES = SCALAR_CAPACITY_CASES + COMPRESSION_CAPACITY_CASES;
export const EVALUATED_CASES = TOTAL_CASES - CAPACITY_CASES;

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
