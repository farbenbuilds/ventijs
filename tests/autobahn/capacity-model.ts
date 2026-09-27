//! Which cases the compiled cap blocks, and how many.
//!
//! Split out of `expected-cases.ts` because this is the one part of the model that changes
//! when the build does, and the file the rest of the harness imports should be readable as
//! arithmetic. The facts it reads -- what the pinned suite puts on the wire -- are in
//! `case-sizes.ts`.

import { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";
import {
  COMPRESSION_OVER_LIMIT_ROWS,
  COMPRESSION_SIZES,
  COMPRESSION_SIZE_ROWS,
  DEFLATE_PARAMETER_SETS_GROUP_12,
  DEFLATE_PARAMETER_SETS_GROUP_13,
} from "./case-sizes.ts";
import { TOTAL_CASES } from "./case-sizes.ts";

export { INBOUND_LIMIT_BYTES };

/// One entry of the suite's `Cases` expansion, with the byte count the suite
/// actually puts on the wire. `prefix` matches a case id by string prefix, so
/// "9.1" covers 9.1.1 through 9.1.6.
///
/// **Per case, not per prefix.** Group 9 walks `DATALEN` from 1 KiB to 4 MiB *within*
/// one prefix: 9.1.1 is 1024 bytes and 9.1.6 is 4194304. Recording one number for the
/// prefix is a statement about the largest case in it, and at a cap that falls inside
/// that range it is a statement about none of them. The previous shape said all six of
/// 9.1 were 64 KiB, so a 64 KiB cap blocked nothing in the group and the run evaluated
/// cases the engine still could not hold -- which is how ten group-9 failures that are
/// the cap being the cap got reported as protocol failures.
///
/// Every case the suite generates is listed, not only the ones over the cap, because
/// whether a case is capacity-blocked is a *function* of the compiled limit rather than
/// a fact about the case. A list holding only the cases that happened to be over the last
/// limit the build was compiled with is a list that is wrong the moment the constant
/// moves, and it is wrong silently.
export type CapacityRule = {
  readonly prefix: string;
  /// One entry per case in the prefix, in sub-id order, so the count and the sizes cannot
  /// disagree. A prefix with a single case has one entry.
  readonly payloadBytes: readonly number[];
  readonly origin: string;
};

/// The suite's `DATALEN` table for group 9, which the pinned client generates its cases
/// from. Groups 9.1 and 9.2 walk the same six sizes; 9.3 and 9.4 walk nine, adding the
/// 16 MiB to 640 MiB range; 9.5 and 9.6 walk the first six of the nine.
const GROUP_9_SMALL = [1024, 16_384, 65_536, 262_144, 1_048_576, 4_194_304] as const;
const GROUP_9_WIDE = [
  65_536, 262_144, 1_048_576, 4_194_304, 16_777_216, 67_108_864, 104_857_600, 419_430_400,
  671_088_640,
] as const;

export const CAPACITY_RULES = [
  { prefix: "7.1.6", payloadBytes: [256 * 1024], origin: "Case7_1_6.DATALEN" },
  { prefix: "9.1", payloadBytes: GROUP_9_SMALL, origin: "Case9_1_x.DATALEN" },
  { prefix: "9.2", payloadBytes: GROUP_9_SMALL, origin: "Case9_2_x.DATALEN" },
  { prefix: "9.3", payloadBytes: GROUP_9_WIDE, origin: "Case9_3_x.DATALEN" },
  { prefix: "9.4", payloadBytes: GROUP_9_WIDE, origin: "Case9_4_x.DATALEN" },
  { prefix: "9.5", payloadBytes: GROUP_9_WIDE.slice(0, 6), origin: "Case9_5_x.DATALEN" },
  { prefix: "9.6", payloadBytes: GROUP_9_WIDE.slice(0, 6), origin: "Case9_6_x.DATALEN" },
  { prefix: "10.1.1", payloadBytes: [65_536], origin: "Case10_1_1.payload" },
] as const satisfies readonly CapacityRule[];

/// The cases blocked by the cap, counted per case rather than per rule, because a rule
/// that straddles the cap blocks some of its cases and not others. Counting the rule
/// would over- or under-report by however many of its cases sit on the other side.
export const SCALAR_CAPACITY_CASES = CAPACITY_RULES.reduce(
  (total, rule) => total + rule.payloadBytes.filter((bytes) => bytes > INBOUND_LIMIT_BYTES).length,
  0,
);

export const COMPRESSION_CAPACITY_CASES =
  (DEFLATE_PARAMETER_SETS_GROUP_12 + DEFLATE_PARAMETER_SETS_GROUP_13) * COMPRESSION_OVER_LIMIT_ROWS;

/// The cases the compiled build cannot reach, derived rather than recorded. At a
/// 32 KiB cap this is 44 framing cases plus (5 + 7) * 7 = 84 compression cases,
/// which is the 128 the previous recording held. At 64 KiB the 64 KiB framing
/// cases and two of the compression size rows come into range, and the count
/// falls without anyone editing it.
export const CAPACITY_CASES = SCALAR_CAPACITY_CASES + COMPRESSION_CAPACITY_CASES;

/// The cases the build is expected to be able to answer: everything selected that
/// is not above the cap. A function of the categories in play, so raising the
/// compiled cap moves it by exactly the cases the cap was blocking.
export const EVALUATED_CASES = TOTAL_CASES - CAPACITY_CASES;

export function capacityRuleFor(caseId: string): CapacityRule | null {
  for (const rule of CAPACITY_RULES) {
    if (caseId === rule.prefix || caseId.startsWith(`${rule.prefix}.`)) return rule;
  }
  return null;
}

/// The byte count one case in a rule puts on the wire, or null when the id names no
/// sub-id the rule has. The classifier needs this and not the rule, because "is this case
/// blocked" is per case for the same reason the count is.
export function payloadOf(rule: CapacityRule, caseId: string): number | null {
  if (caseId === rule.prefix) return rule.payloadBytes[0] ?? null;
  const sub = Number(caseId.slice(rule.prefix.length + 1));
  if (!Number.isInteger(sub)) return null;
  return rule.payloadBytes[sub - 1] ?? null;
}

export function isCompressionCase(caseId: string): boolean {
  const parts = caseId.split(".");
  if (parts.length !== 3) return false;
  if (parts[0] !== "12" && parts[0] !== "13") return false;
  const row = Number(parts[2]);
  if (!Number.isInteger(row) || row < 1 || row > COMPRESSION_SIZES) return false;
  return COMPRESSION_SIZE_ROWS[row - 1] > INBOUND_LIMIT_BYTES;
}

export function exceedsInboundLimit(caseId: string): boolean {
  const rule = capacityRuleFor(caseId);
  if (rule === null) return isCompressionCase(caseId);
  const bytes = payloadOf(rule, caseId);
  return bytes !== null && bytes > INBOUND_LIMIT_BYTES;
}
