//! The version is stated in three files that cannot import each other, and the marker that
//! stops the bump from re-entering itself is a string that has to match elsewhere. Both are
//! the bug this repository has shipped three times: one fact stated twice, one stale.

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
const TAG_SCRIPT = read("scripts/tag-release.mjs");

/// The five forms GitHub recognises, shared with `check-commit-msg.mjs`. A check that knew
/// four works right up until the fifth is used, which is why this is a list.
const MARKERS = ["skip ci", "ci skip", "no ci", "skip actions", "actions skip"];

/// The version in a `## [...]` heading, so the changelog can be read as a log rather than
/// diffed as text.
const HEADING = /^## \[([^\]]+)\]/gm;

/// The prerelease counter, or 0 for a stable version: a stable heading sorts first.
const counterOf = (version: string) => Number(/(\d+)$/.exec(version)?.[1] ?? 0);

type Entry = { readonly version: string; readonly counter: number };

/// Zipped, not indexed: a non-null assertion asserts on `undefined`, not the invariant.
function logged(): Entry[] {
  return [...CHANGELOG.matchAll(HEADING)].map((match) => {
    const version = match[1] ?? "";
    return { version, counter: counterOf(version) };
  });
}

/// Adjacent pairs, newest first: `[a, b]` names the direction, where `toEqual` does not.
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
  expect(BUMP_WORKFLOW).toContain(`!startsWith(github.event.head_commit.message, '${marker}')`);
  expect(BUMP_WORKFLOW).toContain(`git commit -m "${marker} v$VERSION"`);
  expect(BUMP_WORKFLOW).toContain("VERSION: ${{ steps.bump.outputs.version }}");
});

test("the commit the tag points at carries no CI skip marker", () => {
  // GitHub reads a marker anywhere in a *tagged* commit's message, so one here would skip
  // `publish.yml`: a tag on `main`, nothing on npm, and no workflow to report it.
  const commit = /git commit -m "([^"]*)"/.exec(BUMP_WORKFLOW)?.[1] ?? "";
  expect(commit).not.toBe("");
  for (const marker of MARKERS) expect(commit.includes(`[${marker}]`), commit).toBe(false);
});

test("the bump tags through the release app, the one credential that starts a run", () => {
  // `publish.yml` takes no dispatch, and a tag pushed with `GITHUB_TOKEN` starts no run, so
  // the tag is pushed with an installation token; the bump commit itself stays silent.
  expect(BUMP_WORKFLOW).toContain("actions/create-github-app-token@v3");
  expect(BUMP_WORKFLOW).toContain("secrets.RELEASE_APP_PRIVATE_KEY");
  expect(BUMP_WORKFLOW).toContain('git push "$remote" "refs/tags/$TAG"');
  expect(BUMP_WORKFLOW).not.toContain("gh workflow run");
  expect(BUMP_WORKFLOW).not.toContain("id-token");
});

test("a re-run finds its own commit and an existing tag rather than bumping twice", () => {
  // A lost tag push is recovered by re-running: the version is already committed, and the
  // tag is pushed only when the remote does not have it.
  expect(BUMP_WORKFLOW).toContain("is already committed");
  expect(BUMP_WORKFLOW).toContain('git ls-remote --tags "$remote" "refs/tags/$TAG"');
  expect(BUMP_WORKFLOW).toContain('echo "$TAG already exists"');
});

test("the bump keeps the history the changelog scan reads", () => {
  // `bump-version` finds the previous bump commit through `git log`, so a depth-1 checkout
  // writes no changelog section at all.
  expect(BUMP_WORKFLOW).toContain("fetch-depth: 0");
});

test("a release pushes the tag itself, not only what --follow-tags carries", () => {
  // `--follow-tags` carries annotated tags; this release tag is lightweight on a branch
  // that is already up to date, which is exactly the tag it leaves behind.
  expect(TAG_SCRIPT).toContain('push(["push", "origin", branch,');
  expect(TAG_SCRIPT).toContain("refs/tags/${tag}`]);");
  expect(TAG_SCRIPT).not.toMatch(/"--follow-tags"/);
});

test("a release tags the version it finds rather than choosing one", () => {
  // `bumpp` commits, tags, and pushes in one step, so leaving it on the release path would
  // move the version at tag time and leave the tag behind the manifest, which is what
  // `check-release-tag.mjs` refuses to publish.
  expect(MANIFEST.scripts.release).toBe("node scripts/tag-release.mjs");
  expect(Object.values(MANIFEST.scripts)).not.toContain("bumpp");
});
