//! The version is stated in three files that cannot import each other, and the marker that
//! stops the bump from re-entering itself is a string that has to match elsewhere. Both are
//! the bug this repository has shipped three times: one fact stated twice, one of them stale.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

type Manifest = { readonly version: string; readonly scripts: Record<string, string> };

const MANIFEST = JSON.parse(read("package.json")) as Manifest;
const ZON = read("build.zig.zon");
const README = read("README.md");
const CHANGELOG = read("CHANGELOG.md");
const BUMP_SCRIPT = read("scripts/bump-version.mjs");
const BUMP_WORKFLOW = read(".github/workflows/bump.yml");
const PUBLISH_WORKFLOW = read(".github/workflows/publish.yml");

/// The five forms GitHub recognises, shared with `check-commit-msg.mjs`. A check that knew
/// four works right up until the fifth is used, which is why this is a list.
const MARKERS = ["skip ci", "ci skip", "no ci", "skip actions", "actions skip"];

/// The version in a `## [...]` heading, so the changelog can be read as a log rather than
/// diffed as text.
const HEADING = /^## \[([^\]]+)\]/gm;

/// The prerelease counter, or 0 for a stable version: a stable heading sorts ahead of the
/// prereleases it supersedes, which is 0 and therefore first.
const counterOf = (version: string) => Number(/(\d+)$/.exec(version)?.[1] ?? 0);

type Entry = { readonly version: string; readonly counter: number };

/// Zipped, not indexed: a non-null assertion asserts on `undefined`, not the invariant.
function logged(): Entry[] {
  return [...CHANGELOG.matchAll(HEADING)].map((match) => {
    const version = match[1] ?? "";
    return { version, counter: counterOf(version) };
  });
}

/// Adjacent pairs, newest first: a `[a, b]` assertion names the direction, where `toEqual`
/// reports a reversed list as a failure of the whole value rather than of its order.
function descending(values: readonly number[]): [number, number][] {
  return values.slice(1).map((value, index) => [values[index] ?? 0, value]);
}

test("the three sources of the version agree with the manifest", () => {
  expect(/\.version\s*=\s*"([^"]+)"/.exec(ZON)?.[1]).toBe(MANIFEST.version);
  expect(/is at\s*`([^`]+)`/.exec(README)?.[1]).toBe(MANIFEST.version);
});

test("the changelog is a log: newest first, and never ahead of the manifest", () => {
  const entries = logged();
  expect(entries.length).toBeGreaterThan(0);

  // The newest heading is not asserted to equal the version: a merge that reached no
  // changelog type still advances the version and leaves no section. What must hold is that
  // the log never runs ahead of the manifest, since a heading newer than the version is what
  // a hand-edited changelog looks like.
  const current = counterOf(MANIFEST.version);
  expect(entries[0]?.counter).toBeLessThanOrEqual(current);
  for (const [newer, older] of descending(entries.map((entry) => entry.counter)))
    expect(older).toBeLessThanOrEqual(newer);
});

test("the loop guard matches the commit the bump makes", () => {
  // The guard reads the head commit's subject and the bump writes one, so a marker that
  // differs between them is an infinite bump rather than a visible failure.
  const marker = /const MARKER = "([^"]+)"/.exec(BUMP_SCRIPT)?.[1];
  expect(marker).toBeDefined();
  expect(BUMP_WORKFLOW).toContain(`head_commit.message, '${marker}'`);
  expect(BUMP_WORKFLOW).toContain(`git commit -m "${marker} v`);
});

test("the commit the tag points at carries no CI skip marker", () => {
  // GitHub reads a marker anywhere in a *tagged* commit's message, so one here would skip
  // `publish.yml`: a tag on `main`, nothing on npm, and no workflow to report it.
  const commit = /git commit -m "([^"]*)"/.exec(BUMP_WORKFLOW)?.[1] ?? "";
  expect(commit).not.toBe("");
  for (const marker of MARKERS) expect(commit.includes(`[${marker}]`), commit).toBe(false);
});

test("the bump tags the version, and does so idempotently", () => {
  // Tagging is what publishes, so a run that failed between the commit and the tag leaves
  // `main` bumped but untagged: both steps tolerate a re-run, and the tag step must see the
  // remote's tags rather than assume a fresh clone.
  expect(BUMP_WORKFLOW).toContain('git tag "$TAG"');
  expect(BUMP_WORKFLOW).toContain('git push origin "$TAG"');
  expect(BUMP_WORKFLOW).toContain("fetch-depth: 0");
  expect(BUMP_WORKFLOW).toContain("already exists");
});

test("a GitHub Release is created only for a tag that published", () => {
  // A release page for a version that is not on the registry advertises an install that
  // fails, so the job needs the publish result rather than merely following it.
  expect(PUBLISH_WORKFLOW).toContain("needs: [bindings, bindings-musl, publish]");
  expect(PUBLISH_WORKFLOW).toContain("needs.publish.result == 'success'");
  expect(PUBLISH_WORKFLOW).toContain("startsWith(github.ref, 'refs/tags/v')");
  // `contents: write` is the whole set: the job creates a page and must not be able to
  // publish, so it holds no `id-token`.
  const job = PUBLISH_WORKFLOW.slice(PUBLISH_WORKFLOW.indexOf("\n  release:"));
  expect(job).toContain("contents: write");
  expect(job.slice(0, job.indexOf("steps:"))).not.toContain("id-token");
});

test("a release tags the version it finds rather than choosing one", () => {
  // `bumpp` commits, tags, and pushes in one step, so leaving it on the release path would
  // move the version at tag time and leave the tag behind the manifest, which is what
  // `check-release-tag.mjs` refuses to publish.
  expect(MANIFEST.scripts.release).toBe("node scripts/tag-release.mjs");
  expect(Object.values(MANIFEST.scripts)).not.toContain("bumpp");
});
