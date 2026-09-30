#!/usr/bin/env node
// Advances the version in the three files that state it, by a release directive.
//
// The directive is `release:<kind>` labels on the merge's pull request, or the `bump.yml`
// dispatch inputs; with none, a prerelease advances its counter and a stable version starts
// the next patch's train on `alpha.0`. `scripts/next-version.mjs` owns the transition table
// and `tests/tooling/version.test.ts` holds it; this script owns the files.
//
// The three files cannot import each other -- a manifest, a Zig build manifest, and a
// document -- so each is rewritten from the version already in `package.json`, and a
// disagreement is reported rather than overwritten. Writing the truth over a drifted file
// hides the drift instead of failing on it, which is the shape of every bug this pipeline
// has already had: the same fact stated in two places, one of them stale.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextVersion } from "./next-version.mjs";

const PACKAGE = "package.json";
const CHANGELOG = "CHANGELOG.md";
const MARKER = "chore(release):";

/// This repository, from the script's own location rather than the working directory.
///
/// Resolved against `process.cwd()`, a run from anywhere else edits whatever `package.json`
/// it finds there: a subdirectory rewrites nothing useful, and a directory with an
/// unrelated manifest gets a version and a changelog section written into it.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/// The subjects that reach the changelog, and the heading each is listed under. A merge is
/// titled by its pull request, and a squash merge keeps that title as its subject.
const REACHING = [
  { pattern: /^feat(\(|!)/, heading: "Added" },
  { pattern: /^fix(\(|!)/, heading: "Fixed" },
  { pattern: /^perf(\(|!)/, heading: "Performance" },
  { pattern: /^(build|ci|refactor|style)(\(|!)/, heading: "Changed" },
];

/// The version sits between a prefix and a suffix in each source, captured so a rewrite
/// touches the digits alone. Matched as text because two of the three are not JSON.
const SOURCES = [
  { path: PACKAGE, pattern: /("version":\s*")([^"]+)(")/ },
  { path: "build.zig.zon", pattern: /(\.version\s*=\s*")([^"]+)(")/ },
  { path: "README.md", pattern: /(is at\s*`)([^`]+)(`)/ },
];

const read = (path) => readFileSync(join(ROOT, path), "utf8");
const write = (path, text) => writeFileSync(join(ROOT, path), text);

/// git's stdout, or `null` when git could not answer.
///
/// `null` rather than a throw, because the only question asked of it here is whether a
/// previous bump commit exists, and "no history" is one of the ways the answer is no. A
/// checkout with no commits must bump the version rather than report a git failure.
const git = (args) => {
  try {
    return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
  } catch {
    return null;
  }
};

/// What a source states, or null when it states none. Null fails rather than skips: a
/// renamed key would otherwise leave the file unrewritten and publish the old version.
function stated(source) {
  const match = read(source.path).match(source.pattern);
  return match ? match[2] : null;
}

/// The release directive: `--release major,beta`, `--release=beta`, or bare kinds.
///
/// Unknown kinds fail in `nextVersion`, which owns the table, so the CLI and the workflow
/// cannot disagree about what a directive means.
function releaseKinds(args) {
  return args
    .flatMap((arg) => arg.replace(/^--release(=|$)/, "").split(","))
    .filter((kind) => kind !== "");
}

/// Merged changes since the previous bump, grouped under the heading each type belongs to.
///
/// The boundary is the last bump commit rather than the last tag, because a tag is the
/// release decision and there may be several merges between two of them. Diffing against
/// the tag would reprint every earlier section under each new version.
///
/// No boundary means no section. The first run on a repository has no marker yet, and
/// falling back to all of history would file the project's entire commit log under the
/// next version; a lost marker after a history rewrite would do the same silently. The
/// version still advances either way, because a missing entry is recoverable and a
/// fabricated one is not.
function changelogSection(version) {
  const since = git(["log", `--grep=^${MARKER}`, "-1", "--format=%H"])?.trim() ?? "";
  if (since === "") {
    process.stderr.write(`bump-version: no earlier ${MARKER} commit, so no changelog section\n`);
    return null;
  }
  const subjects = (git(["log", "--no-merges", "--format=%s", `${since}..HEAD`]) ?? "")
    .split("\n")
    .filter((subject) => subject !== "");

  const groups = new Map();
  for (const subject of subjects) {
    const entry = REACHING.find(({ pattern }) => pattern.test(subject));
    if (!entry) continue;
    if (!groups.has(entry.heading)) groups.set(entry.heading, []);
    groups.get(entry.heading).push(subject);
  }

  const date = new Date().toISOString().slice(0, 10);
  const body = [...groups].map(
    ([heading, lines]) => `### ${heading}\n\n${lines.map((line) => `- ${line}`).join("\n")}`,
  );
  if (body.length === 0) return null;
  return `## [${version}] - ${date}\n\n${body.join("\n\n")}\n\n`;
}

function main() {
  const current = JSON.parse(read(PACKAGE)).version;
  const drifted = SOURCES.filter((source) => stated(source) !== current);
  for (const source of drifted) {
    process.stderr.write(
      `bump-version: ${source.path} states ${stated(source)}, ${PACKAGE} states ${current}\n`,
    );
  }
  if (drifted.length > 0)
    throw new Error(`bump-version: ${drifted.length} sources disagree with ${PACKAGE}`);

  const next = nextVersion(current, releaseKinds(process.argv.slice(2)));

  for (const source of SOURCES)
    write(source.path, read(source.path).replace(source.pattern, `$1${next}$3`));

  // Inserted above the first released heading, so the preamble stays the preamble. A
  // merge that reached no changelog type still gets a version and leaves no section: an
  // empty heading would read as a release that changed nothing.
  const changelog = read(CHANGELOG);
  const first = changelog.search(/^## \[/m);
  if (first === -1) throw new Error(`bump-version: ${CHANGELOG} has no released heading`);
  const section = changelogSection(next);
  if (section !== null)
    write(CHANGELOG, changelog.slice(0, first) + section + changelog.slice(first));

  console.log(`bump-version: ${current} -> ${next}`);
}

main();
