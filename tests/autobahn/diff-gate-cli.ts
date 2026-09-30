#!/usr/bin/env node
/// Decides whether this push needs the conformance suite, and prints the answer
/// in the form the workflow consumes.
///
/// It runs before any toolchain is installed: the decision needs git and nothing
/// else, so a skipped run costs a checkout and a diff rather than a Zig build, an
/// image pull, and a sharded suite.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/// Events that must always measure, whatever moved. A scheduled run is the
/// weekly refresh of the report and a manual dispatch is a deliberate request, so
/// neither is a candidate for skipping.
const ALWAYS_RUN_EVENTS: ReadonlySet<string> = new Set(["schedule", "workflow_dispatch"]);

/// The file the suite job writes on success and this script reads back.
const WATERMARK_FILE = ".autobahn-watermark";

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8" }).trim();
}

/// The commit the suite last ran on this ref, read from the cache entry the
/// suite job writes on success.
///
/// A missing or unreadable watermark is not an error: it is the first run on this
/// branch, and the first run must measure.
function readWatermark(): string | null {
  try {
    const raw = readFileSync(WATERMARK_FILE, "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    // No cache entry is the first run on this ref, not an error.
    return null;
  }
}

function changedSince(base: string): readonly string[] {
  const output = git(["diff", "--name-only", `${base}...HEAD`]);
  if (output === "") return [];
  return output.split("\n").filter((line) => line !== "");
}

function resolve(): DiffDecision {
  const alwaysRun = ALWAYS_RUN_EVENTS.has(process.env["GITHUB_EVENT_NAME"] ?? "");
  const watermark = readWatermark();
  if (alwaysRun || watermark === null) {
    return decideRun({ watermark, changedPaths: [], alwaysRun });
  }
  let paths: readonly string[];
  try {
    paths = changedSince(watermark);
  } catch (error) {
    // Fail toward running: an unusable history is not evidence that nothing moved.
    return {
      run: true,
      reason: `could not diff against ${watermark}: ${(error as Error).message}`,
      changed: [],
    };
  }
  return decideRun({ watermark, changedPaths: paths, alwaysRun });
}

function announce(decision: DiffDecision): void {
  const path = process.env["GITHUB_STEP_SUMMARY"];
  if (path === undefined) return;
  appendFileSync(
    path,
    `Autobahn: ${decision.run ? "running the suite" : "skipping the suite"} (${decision.reason}).\n`,
  );
}

function main(): number {
  const decision = resolve();
  announce(decision);
  // `run` is read by the workflow as a step output, so the two keys are the
  // whole contract between this script and the YAML.
  process.stdout.write(`run=${decision.run}\n`);
  process.stdout.write(`reason=${decision.reason}\n`);
  return 0;
}

/// A test imports the decision functions, so only a process started by path runs the CLI.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
