#!/usr/bin/env node
/// Decides whether this push needs the conformance suite, and prints the answer
/// in the form the workflow consumes.
///
/// It runs before any toolchain is installed: the decision needs git and nothing
/// else, so a skipped run costs a checkout and a diff rather than a Zig build, an
/// image pull, and a sharded suite.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { decideRun } from "./diff-gate.ts";
import type { DiffDecision } from "./diff-gate.ts";

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

process.exitCode = main();
