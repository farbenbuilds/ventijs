/// The Autobahn report contract: how many cases the pinned suite produces for
/// groups 1-7 and 9-13, and which of them the pinned engine build cannot reach
/// because of its compiled-in message capacity.
///
/// 517 is the total in `CI_CD_PIPELINE.md` and is the number the gate holds the
/// run to. `fuzzingclient.json` also selects `11.*`, but the pinned suite defines
/// no group 11 cases, so the pattern contributes nothing and 517 already accounts
/// for it.
///
/// The `behaviorClose` vocabulary is what the gate uses to tell a truncated or
/// foreign report from a conformant one. The 514 `OK` and 3 `INFORMATIONAL` split
/// the reference `ws` report produces is recorded in `CI_CD_PIPELINE.md` as
/// context, not asserted here: holding ventijs to it would assert that all 389
/// evaluated cases pass, which is the per-case gate's job.
export const TOTAL_CASES = 517;

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

/// The capacity half of the model lives in `capacity-model.ts` and the facts it reads in
/// `case-sizes.ts`; both are re-exported here so the harness has one import for the
/// contract. The cap is read out of the built addon rather than restated anywhere,
/// because a restated copy is how the engine's cap and this arithmetic drift apart: the
/// cap was raised from 32 KiB to 64 KiB once already and every literal kept asserting
/// 32 KiB.

// The capacity model and the suite's size facts, re-exported so the harness has one
// import for the contract rather than three for its parts. `INBOUND_LIMIT_BYTES` is the
// one number here that is read out of the built addon rather than written down, which is
// why it is re-exported rather than recomputed.
export { INBOUND_LIMIT_BYTES } from "./inbound-limit.ts";
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
