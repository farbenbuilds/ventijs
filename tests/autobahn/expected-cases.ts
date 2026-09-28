/// The Autobahn report contract: how many cases the pinned suite produces for groups 1-7 and
/// 9-13, and which of them the pinned engine build cannot reach because of its message capacity.
///
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
/// The reference split, for the run summary only.
export const REFERENCE_CLOSURE_OK_CASES = 514;
export const REFERENCE_CLOSURE_INFORMATIONAL_CASES = 3;

// The capacity model and the suite's size facts, re-exported so the harness has one import for
// the contract. `INBOUND_LIMIT_BYTES` is the one number read out of the built addon rather than
// written down: a restated copy is how the engine's cap and this arithmetic drift apart, and the
// cap was raised from 32 KiB to 64 KiB once already with every literal still asserting 32 KiB.
export { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";
export { TOTAL_CASES } from "./case-sizes.ts";
export {
  CAPACITY_CASES,
  CAPACITY_RULES,
  COMPRESSION_CAPACITY_CASES,
  EVALUATED_CASES,
  SCALAR_CAPACITY_CASES,
  capacityRuleFor,
  exceedsInboundLimit,
  isCompressionCase,
  payloadOf,
  type CapacityRule,
} from "./capacity-model.ts";
export {
  COMPRESSION_CASES,
  COMPRESSION_GROUPS,
  COMPRESSION_OVER_LIMIT_ROWS,
  COMPRESSION_SIZES,
  COMPRESSION_SIZE_ROWS,
  DEFLATE_PARAMETER_SETS_GROUP_12,
  DEFLATE_PARAMETER_SETS_GROUP_13,
} from "./case-sizes.ts";
