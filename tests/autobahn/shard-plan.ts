import { MEASURED_FRAMING_COUNTS } from "./shard-measurements.ts";
import weights from "./shard-weights.json" with { type: "json" };
import { COMPRESSION_CASES, COMPRESSION_GROUPS, TOTAL_CASES } from "./expected-cases.ts";
import type { SuiteMode } from "./suite-mode.ts";
import { MODE_COUNTS } from "./suite-mode.ts";

/// `cases` is always `<group>.*` for whole groups, never a sub-group glob, so the union of
/// every shard is the same case set one unsplit configuration selects.
export type Shard = {
  readonly id: number;
  /// Every shard is a separate process with its own engine instance and listener.
  readonly port: number;
  readonly groups: readonly string[];
  readonly cases: readonly string[];
  /// Expected `wstest` seconds; the critical path of a sharded run is the largest of these.
  readonly costSeconds: number;
};

/// Above the client's own 9001, so a shard cannot collide with a default the container picks.
export const SHARD_PORT_BASE = 9401;

/// The suite waits on the client's own handshake timers rather than on CPU, so concurrent shards
/// do not contend. A local run with `AUTOBAHN_SHARDS` unset stays unsplit.
export const DEFAULT_SHARD_COUNT = 4;

/// More shards than groups leaves an empty shard, so the effective ceiling is the group count.
type Weights = {
  /// Seconds of `wstest` time per case, per group.
  readonly groups: Readonly<Record<string, number>>;
  /// How many cases each group expands to in the pinned suite.
  readonly caseCounts: Readonly<Record<string, number>>;
};

const TABLE = weights as Weights;

/// Derived from the case count, so a corrected group count re-prices itself.
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

/// Longest-processing-time bin packing: the heaviest group into the emptiest shard, repeatedly --
/// the greedy bound for identical machines, and it keeps the split a pure function of the table.
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

/// A shard that owns no group runs no cases, so the union is short of the mode's total: the
/// ceiling is the group count, not a fixed number.
export function maxShardsFor(mode: SuiteMode): number {
  return MODE_COUNTS[mode].groups.length;
}

///
/// One resolver for the runner, the self-check, and the flag, so a value accepted in one place
/// cannot be rejected in another.
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

/// The counts are measurements, so this pins them and requires them to still add up to the
/// independently asserted totals -- a sum alone accepted a table with groups 6 and 9 swapped.
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
