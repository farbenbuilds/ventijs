import { MEASURED_FRAMING_COUNTS } from "./shard-measurements.ts";
import weights from "./shard-weights.json" with { type: "json" };
import { COMPRESSION_CASES, COMPRESSION_GROUPS, TOTAL_CASES } from "./expected-cases.ts";
import type { SuiteMode } from "./suite-mode.ts";
import { MODE_COUNTS } from "./suite-mode.ts";

/// One shard's share of the suite.
///
/// `cases` is always `<group>.*` for whole groups, never a sub-group glob, so the
/// union of every shard is provably the same case set a single unsplit
/// configuration selects. That is the property that keeps sharding safe: a
/// mis-priced weight can cost wall clock and nothing else, because the gate
/// still holds the run to the mode's total case count.
export type Shard = {
  readonly id: number;
  /// Host port this shard's target binds. Every shard is a separate process with
  /// its own engine instance and its own listener.
  readonly port: number;
  readonly groups: readonly string[];
  readonly cases: readonly string[];
  /// Expected seconds of `wstest` time for this shard, from the weight table's
  /// per-case cost times the group's case count. The critical path of a sharded
  /// run is the largest of these, so it is the number to watch.
  readonly costSeconds: number;
};

/// First port a shard binds. It is above the fuzzing client's own 9001 so a shard
/// can never collide with a default the container might pick for itself.
export const SHARD_PORT_BASE = 9401;

/// Shards CI plans by default, one per runner core. The suite spends nearly all
/// of its time waiting on the client's own handshake timers rather than on CPU,
/// so concurrent shards do not contend; this stays conservative on the
/// pessimistic reading where they do. The workflow sets `AUTOBAHN_SHARDS`, and a
/// local run with the variable unset stays unsplit.
export const DEFAULT_SHARD_COUNT = 4;

/// More shards than groups would leave an empty shard, which runs zero cases and
/// fails the run through the count check rather than through the plan. The
/// effective ceiling is therefore the group's own count, applied per mode.
type Weights = {
  /// Seconds of `wstest` time per case, per group.
  readonly groups: Readonly<Record<string, number>>;
  /// How many cases each group expands to in the pinned suite.
  readonly caseCounts: Readonly<Record<string, number>>;
};

const TABLE = weights as Weights;

/// Seconds a shard expects to spend, given the groups it owns. Deriving the total
/// from the case count rather than storing it means a group whose count is
/// corrected re-prices itself instead of needing two edits in step.
function costOf(groups: readonly string[]): number {
  let total = 0;
  for (const group of groups) {
    const perCase = TABLE.groups[group] ?? 0;
    const count = TABLE.caseCounts[group] ?? 0;
    total += perCase * count;
  }
  return total;
}

function patternsFor(groups: readonly string[]): readonly string[] {
  return groups.map((group) => `${group}.*`);
}

/// Longest-processing-time bin packing: the heaviest group into the emptiest
/// shard, repeatedly. It is the greedy bound for identical machines and it keeps
/// the split a pure function of the weight table, so two runs of the same
/// configuration shard identically.
function pack(
  groupWeights: readonly { group: string; weight: number }[],
  shards: number,
): string[][] {
  const bins: string[][] = Array.from({ length: shards }, () => []);
  const loads = Array.from<number>({ length: shards }).fill(0);
  const ordered = [...groupWeights].sort((left, right) => right.weight - left.weight);
  for (const entry of ordered) {
    let lightest = 0;
    for (let index = 1; index < shards; index += 1) {
      if (loads[index] < loads[lightest]) lightest = index;
    }
    bins[lightest].push(entry.group);
    loads[lightest] += entry.weight;
  }
  return bins;
}

/// The largest usable shard count for a mode.
///
/// A shard that owns no group runs no cases, and the union is then short of the
/// mode's total, so the ceiling is the number of groups rather than a fixed
/// number: a validator that accepted more would approve a configuration that
/// cannot pass.
export function maxShardsFor(mode: SuiteMode): number {
  return MODE_COUNTS[mode].groups.length;
}

/// Validates a shard count against a mode, from the environment or from the flag.
///
/// One resolver, used by the runner, by the plan self-check, and by the flag, so a
/// value accepted in one place cannot be rejected in another.
export function resolveShardCount(raw: string | number, mode: SuiteMode): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  const max = maxShardsFor(mode);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new RangeError(
      `shard count must be an integer in 1..${max} for the ${mode} selection, got ${String(raw)}`,
    );
  }
  return parsed;
}

/// Splits a mode's groups into `shardCount` shards balanced by expected cost.
export function planShards(shardCount: number, mode: SuiteMode): readonly Shard[] {
  resolveShardCount(shardCount, mode);
  const groups = MODE_COUNTS[mode].groups;
  const priced = groups.map((group) => ({ group, weight: costOf([group]) }));
  return pack(priced, shardCount).map((owned, id) => ({
    id,
    port: SHARD_PORT_BASE + id,
    groups: owned,
    cases: patternsFor(owned),
    costSeconds: costOf(owned),
  }));
}

/// Self-check on the committed weight table, run by the unit tests and by the
/// preflight.
///
/// The counts are now measurements rather than a derivation, so the check is
/// stronger than a sum: the measured per-group counts are pinned, and they must
/// still add up to the totals the repository asserts independently. A sum alone
/// was enough to accept a table that had group 6 and group 9 the wrong way round.
export function weightTableIsConsistent(): boolean {
  for (const [group, count] of Object.entries(MEASURED_FRAMING_COUNTS)) {
    if (TABLE.caseCounts[group] !== count) return false;
  }
  const counts = Object.entries(TABLE.caseCounts);
  const compression = counts
    .filter(([group]) => (COMPRESSION_GROUPS as readonly string[]).includes(group))
    .reduce((total, [, count]) => total + count, 0);
  if (compression !== COMPRESSION_CASES) return false;
  const framing = counts
    .filter(([group]) => !(COMPRESSION_GROUPS as readonly string[]).includes(group))
    .reduce((total, [, count]) => total + count, 0);
  return framing + compression === TOTAL_CASES;
}
