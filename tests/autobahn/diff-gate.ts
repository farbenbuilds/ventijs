/// Decides whether a push can skip the conformance suite.
///
/// GitHub evaluates a job's `paths` filter against the *whole pull request diff*,
/// not the incremental push, so a branch that already touched the engine re-runs
/// the suite on every later commit however unrelated that commit is. That is the
/// waste this module removes: it compares the commit under test against the last
/// one the suite actually ran on the same ref, not against the merge base, which
/// is what `paths` already does.
///
/// The comparison is deliberately one-directional and fail-toward-running. Any
/// condition this cannot resolve positively is answered `run`, because a
/// conformance gate that silently stops running is worse than a slow one.
export type DiffDecision = {
  readonly run: boolean;
  /// One line naming the last tested commit, or why there is none.
  readonly reason: string;
  /// Engine-relevant paths in the delta. Empty is the only reason to skip.
  readonly changed: readonly string[];
};

/// Everything that can change RFC 6455 behaviour or how the suite is measured.
///
/// This is the union of the workflow's own `paths` filter and its harness tree,
/// kept as data so the decision and the filter cannot drift apart silently: the
/// test asserts the filter's entries are a subset of this set.
export const ENGINE_PATHS: readonly string[] = [
  "**.zig",
  "build.zig",
  "build.zig.zon",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.test.json",
  "tests/autobahn/**",
  ".github/workflows/autobahn.yml",
];

/// Matches one repository-relative path against the engine set.
///
/// `**.zig` is a suffix match, because GitHub's filter treats it that way and the
/// point of the two agreeing is that a path the filter catches the gate catches
/// too. `tests/autobahn/**` is a prefix match on a directory.
export function isEnginePath(path: string): boolean {
  if (path.endsWith(".zig")) return true;
  return ENGINE_PATHS.includes(path) || path.startsWith("tests/autobahn/");
}

/// Whether a push may skip the suite.
///
/// `watermark` is the commit the suite last ran on this ref. `null` means there is
/// no record, which is the first run on a branch and must always measure.
export function decideRun(input: {
  readonly watermark: string | null;
  readonly changedPaths: readonly string[];
  /// Events that are the backstop rather than a candidate change.
  readonly alwaysRun: boolean;
}): DiffDecision {
  if (input.alwaysRun) {
    return { run: true, reason: "scheduled or manual run", changed: [] };
  }
  if (input.watermark === null || input.watermark === "") {
    return { run: true, reason: "no previous run recorded on this ref", changed: [] };
  }
  const changed = input.changedPaths.filter((path) => isEnginePath(path));
  if (changed.length > 0) {
    return { run: true, reason: "the engine or the harness moved", changed };
  }
  return {
    run: false,
    reason: `nothing engine-relevant moved since ${input.watermark}`,
    changed: input.changedPaths,
  };
}
