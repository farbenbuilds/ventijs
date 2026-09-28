//! Which cases the compiled cap blocks, and how many. The facts about the pinned suite are in
//! `case-sizes.ts`; this is the arithmetic over them, and the part that changes with the build.

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

/// One entry of the suite's `Cases` expansion, with the byte count it puts on the wire.
/// **Per case, not per prefix**: group 9 walks `DATALEN` from 1 KiB to 4 MiB *within* one
/// prefix, so a cap inside that range is described by no single number -- ten group-9 failures
/// that were the cap being the cap were once reported as protocol failures.
export type CapacityRule = {
  readonly prefix: string;
  /// One entry per case in the prefix, in sub-id order, so the count and the sizes cannot disagree.
  readonly payloadBytes: readonly number[];
  readonly origin: string;
};

/// The suite's `DATALEN` table for group 9. Groups 9.1 and 9.2 walk the same six sizes; 9.3 and
/// 9.4 walk nine, adding 16 MiB to 640 MiB; 9.5 and 9.6 walk the first six of the nine.
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

/// Counted per case rather than per rule, because a rule that straddles the cap blocks some of its
/// cases and not others.
export const SCALAR_CAPACITY_CASES = CAPACITY_RULES.reduce(
  (total, rule) => total + rule.payloadBytes.filter((bytes) => bytes > INBOUND_LIMIT_BYTES).length,
  0,
);

export const COMPRESSION_CAPACITY_CASES =
  (DEFLATE_PARAMETER_SETS_GROUP_12 + DEFLATE_PARAMETER_SETS_GROUP_13) * COMPRESSION_OVER_LIMIT_ROWS;

/// Derived rather than recorded: at a 32 KiB cap this is 44 framing plus (5 + 7) * 7 = 84
/// compression cases, the 128 the previous recording held. At 64 KiB the count falls with no edit.
export const CAPACITY_CASES = SCALAR_CAPACITY_CASES + COMPRESSION_CAPACITY_CASES;

/// Everything selected that is not above the cap, so raising it moves the count by exactly what it blocked.
export const EVALUATED_CASES = TOTAL_CASES - CAPACITY_CASES;

export function capacityRuleFor(caseId: string): CapacityRule | null {
  for (const rule of CAPACITY_RULES) {
    if (caseId === rule.prefix || caseId.startsWith(`${rule.prefix}.`)) return rule;
  }
  return null;
}

/// The byte count one case in a rule puts on the wire, or null when the id names no sub-id.
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
