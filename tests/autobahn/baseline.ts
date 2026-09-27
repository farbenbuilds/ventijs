import baseline from "./baseline.json" with { type: "json" };

/// The known-failing case set, as committed in `baseline.json`.
///
/// The engine has never passed this suite, so a gate that demanded all 389
/// evaluated cases would be red on arrival and would tell a contributor nothing
/// except that the job is red. A known-failure list is the honest alternative:
/// the gate still fails the moment a case outside the list fails, so a regression
/// cannot hide, and it reports any listed case that starts passing so the list
/// can only shrink. Nothing is excluded from the report; every case is still
/// classified and printed.
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
  /// Space-separated case identifiers, one group per entry. The file is a data
  /// list rather than prose, so it is kept compact enough to read at a glance.
  readonly cases: string;
};

const GROUPS: Readonly<Record<string, BaselineGroup>> = baseline.groups;
const IDS: ReadonlySet<string> = new Set(
  Object.values(GROUPS).flatMap((group) => group.cases.split(" ")),
);

export const ALL_BASELINE_IDS: readonly string[] = [...IDS].sort();

/// Every case id in the baseline whose leading group is in `groups`.
///
/// A run that selects a subset must not treat the baseline entries it did not
/// select as stale: the deflate groups are absent by design in `framing` mode,
/// not missing from the report.
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
