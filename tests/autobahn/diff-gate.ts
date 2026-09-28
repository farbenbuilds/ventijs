/// Decides whether a push can skip the conformance suite. GitHub filters a job against the
/// *whole pull request diff*, not the incremental push, so a branch that already touched the
/// engine re-runs the suite on every later commit. This compares the commit under test against
/// the last one the suite ran on the same ref, and fails toward running.
export type DiffDecision = {
  readonly run: boolean;
  /// One line naming the last tested commit, or why there is none.
  readonly reason: string;
  /// Engine-relevant paths in the delta. Empty is the only reason to skip.
  readonly changed: readonly string[];
};

/// Everything that can change RFC 6455 behaviour or how the suite is measured: the union of the
/// workflow's `paths` filter and its harness tree, kept as data so the two cannot drift apart.
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

/// `**.zig` is a suffix match and `tests/autobahn/**` a directory prefix, because GitHub's filter
/// treats them that way and the point is that a path it catches, this gate catches too.
export function isEnginePath(path: string): boolean {
  if (path.endsWith(".zig")) return true;
  return ENGINE_PATHS.includes(path) || path.startsWith("tests/autobahn/");
}

/// `watermark` is the commit the suite last ran on this ref; `null` means the first run on a
/// branch, which must always measure.
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
