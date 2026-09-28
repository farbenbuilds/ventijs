import baseline from "./baseline.json" with { type: "json" };

/// The known-failing case set. The engine has never passed this suite, so a gate demanding all
/// 389 cases would be red on arrival; a known-failure list still fails the moment a case
/// outside it fails, and reports any listed case that starts passing.
export type Baseline = {
  readonly size: number;
  readonly has: (id: string) => boolean;
  /// Baseline ids inside a set of case groups, for a run that selected a subset.
  idsInGroups: (groups: readonly string[]) => readonly string[];
  readonly groups: readonly {
    readonly group: string;
    readonly reason: string;
    readonly count: number;
  }[];
};

type BaselineGroup = {
  readonly reason: string;
  /// Space-separated case identifiers, one group per entry.
  readonly cases: string;
};

const GROUPS: Readonly<Record<string, BaselineGroup>> = baseline.groups;
const IDS: ReadonlySet<string> = new Set(
  Object.values(GROUPS).flatMap((group) => group.cases.split(" ")),
);

export const ALL_BASELINE_IDS: readonly string[] = [...IDS].sort();

/// A run that selects a subset must not treat the baseline entries it did not select as
/// stale: the deflate groups are absent by design in `framing` mode.
export function idsInGroups(groups: readonly string[]): readonly string[] {
  const wanted = new Set(groups);
  return [...IDS].filter((id) => wanted.has(id.split(".")[0])).sort();
}

export const KNOWN_FAILURES: Baseline = {
  size: IDS.size,
  has: (id: string): boolean => IDS.has(id),
  idsInGroups,
  groups: Object.entries(GROUPS)
    .map(([group, value]) => ({
      group,
      reason: value.reason,
      count: value.cases.split(" ").length,
    }))
    .sort((left, right) => left.group.localeCompare(right.group)),
};
