//! What the pinned suite puts on the wire, per case. **Per case, not per prefix**: group 9
//! walks `DATALEN` from 1 KiB to 4 MiB inside one prefix, so a cap in that range fits no single number.

/// 517 is the total in `CI_CD_PIPELINE.md`; the 514 `OK` and 3 `INFORMATIONAL` split is context.
export const TOTAL_CASES = 517;

import { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";

export type CapacityRule = {
  readonly prefix: string;
  /// One entry per case in the prefix, in sub-id order, so the count and the sizes cannot disagree.
  readonly payloadBytes: readonly number[];
  readonly origin: string;
};

/// Groups 12 and 13 expand five and seven deflate parameter sets over `MSG_SIZES`: 5 x 18 = 90
/// and 7 x 18 = 126.
export const DEFLATE_PARAMETER_SETS_GROUP_12 = 5;
export const DEFLATE_PARAMETER_SETS_GROUP_13 = 7;

/// The payload-length column of the suite's `MSG_SIZES` table, in expansion order.
export const COMPRESSION_SIZE_ROWS = [
  16, 64, 256, 1024, 4096, 8192, 16_384, 32_768, 65_536, 131_072, 8192, 16_384, 32_768, 65_536,
  131_072, 131_072, 131_072, 131_072,
] as const;

export const COMPRESSION_SIZES = COMPRESSION_SIZE_ROWS.length;

export const COMPRESSION_GROUPS = ["12", "13"] as const;
export const COMPRESSION_CASES =
  (DEFLATE_PARAMETER_SETS_GROUP_12 + DEFLATE_PARAMETER_SETS_GROUP_13) * COMPRESSION_SIZES;
export const COMPRESSION_OVER_LIMIT_ROWS = COMPRESSION_SIZE_ROWS.filter(
  (size) => size > INBOUND_LIMIT_BYTES,
).length;

/// Whether a rule's *largest* case is above the compiled cap, which defines capacity-blocked.
export function isOverInboundLimit(rule: CapacityRule): boolean {
  const largest = rule.payloadBytes[rule.payloadBytes.length - 1] ?? 0;
  return largest !== undefined && largest > INBOUND_LIMIT_BYTES;
}
