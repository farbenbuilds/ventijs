//! What the pinned suite puts on the wire, per case.
//!
//! Split out of `expected-cases.ts` because this is the only part of the model that is a
//! fact about the *suite* rather than a derivation. Everything else here is arithmetic on
//! it, and arithmetic is easy to check by reading and facts are not, so the facts get
//! their own file and the arithmetic keeps its own.
//!
//! **Per case, not per prefix.** Group 9 walks `DATALEN` from 1 KiB to 4 MiB *within* one
//! prefix: 9.1.1 is 1024 bytes and 9.1.6 is 4194304. Recording one number for the prefix
//! is a statement about the largest case in it, and at a cap that falls inside that range
//! it is a statement about none of them. The previous shape said all six of 9.1 were
//! 64 KiB, so a 64 KiB cap blocked nothing in the group and the run evaluated cases the
//! engine still could not hold -- which is how ten group-9 failures that are the cap
//! being the cap got reported as protocol failures.

/// One entry of the suite's `Cases` expansion, with the byte count the suite actually puts
/// on the wire. `prefix` matches a case id by string prefix, so "9.1" covers 9.1.1 through
/// 9.1.6.
import { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";

export type CapacityRule = {
  readonly prefix: string;
  /// One entry per case in the prefix, in sub-id order, so the count and the sizes cannot
  /// disagree. A prefix with a single case has one entry.
  readonly payloadBytes: readonly number[];
  readonly origin: string;
};

/// Groups 12 and 13 generate their cases from a cross product: group 12 expands

/// Groups 12 and 13 generate their cases from a cross product: group 12 expands
/// five deflate parameter sets and group 13 expands seven, each over the rows of
/// the suite's `MSG_SIZES` table. The counts are derived from that table rather
/// than restated, so the arithmetic cannot drift away from the sizes it comes
/// from.
///
/// Confirmed against a real 517-case report: group 12 is 5 x 18 = 90 cases and
/// group 13 is 7 x 18 = 126.
export const DEFLATE_PARAMETER_SETS_GROUP_12 = 5;
export const DEFLATE_PARAMETER_SETS_GROUP_13 = 7;

/// The payload-length column of the suite's `MSG_SIZES` table, in expansion
/// order, for case sub-ids `12.x.1` through `12.x.18` and `13.x.1` through
/// `13.x.18`.
export const COMPRESSION_SIZE_ROWS = [
  16, 64, 256, 1024, 4096, 8192, 16_384, 32_768, 65_536, 131_072, 8192, 16_384, 32_768, 65_536,
  131_072, 131_072, 131_072, 131_072,
] as const;

export const COMPRESSION_SIZES = COMPRESSION_SIZE_ROWS.length;

/// Groups 12 and 13 are the per-message-deflate groups, 216 of the 517 cases.
export const COMPRESSION_GROUPS = ["12", "13"] as const;
export const COMPRESSION_CASES =
  (DEFLATE_PARAMETER_SETS_GROUP_12 + DEFLATE_PARAMETER_SETS_GROUP_13) * COMPRESSION_SIZES;
export const COMPRESSION_OVER_LIMIT_ROWS = COMPRESSION_SIZE_ROWS.filter(
  (size) => size > INBOUND_LIMIT_BYTES,
).length;

/// Whether a rule's *largest* case is above the compiled cap, which is the definition of
/// capacity-blocked. Only a rule whose every case is over can be reported as a count; a
/// rule that straddles the cap is counted case by case below.
export function isOverInboundLimit(rule: CapacityRule): boolean {
  const largest = rule.payloadBytes[rule.payloadBytes.length - 1] ?? 0;
  return largest !== undefined && largest > INBOUND_LIMIT_BYTES;
}
