//! The release notes are the changelog sections between two tags, so the boundary is a git
//! question as much as a text one: which tag preceded this commit, and does the changelog
//! have a section for it. Running the script against a real tagged repository is the only
//! way both halves are covered at once.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// `fileURLToPath`, not `.pathname`: on Windows a URL path is `/C:/...`, which `node` reads
// as a relative path under the drive it happens to be on.
const SCRIPT = fileURLToPath(new URL("../../scripts/release-notes.mjs", import.meta.url));
const PREAMBLE = "# Changelog\n\nAll notable changes.\n\n";

function section(version: string, body: string): string {
  return `## [${version}] - 2026-09-29\n\n### Added\n\n- ${body}\n\n`;
}

/// A repository with one commit per merge, tagged for the first `tagged` of them.
///
/// The shape `bump.yml` and `pnpm release` produce together: every merge advances the
/// version, and only some of those versions are released. So the newest commits are
/// untagged, and the previous tag is further back than the previous version.
function repo(versions: readonly string[], tagged: number): string {
  const root = mkdtempSync(join(tmpdir(), "ventiws-notes-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: root,
      stdio: "pipe",
    });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "ventiws", version: "x" }));
  writeFileSync(join(root, "CHANGELOG.md"), PREAMBLE);
  git("init", "-q");

  for (const [index, version] of versions.entries()) {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "ventiws", version }));
    const existing = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    writeFileSync(
      join(root, "CHANGELOG.md"),
      PREAMBLE + section(version, `work ${index + 1}`) + existing.slice(PREAMBLE.length),
    );
    git("add", "-A");
    git("commit", "-q", "-m", `chore(release): v${version}`);
    if (index < tagged) git("tag", `v${version}`);
  }
  return root;
}

/// The notes the script writes, and how many sections it claimed.
function notes(root: string): { readonly text: string; readonly versions: string[] } {
  const out = join(root, "notes.md");
  execFileSync(process.execPath, [SCRIPT, out], { cwd: root, stdio: "pipe" });
  const text = readFileSync(out, "utf8");
  return { text, versions: [...text.matchAll(/^## (\S+)$/gm)].map((match) => match[1] ?? "") };
}

test("a release takes only the sections above the previous tag", () => {
  // One merge since the last release: one section, and the released one is claimed already.
  const result = notes(repo(["1.0.0-alpha.1", "1.0.0-alpha.2"], 1));
  expect(result.versions).toEqual(["1.0.0-alpha.2"]);
  expect(result.text).toContain("- work 2");
  expect(result.text).not.toContain("- work 1");
});

test("several merges between two tags are all included", () => {
  // The case a release exists for: three merges landed since the last tag, so the notes
  // cover all three rather than only the version being tagged.
  const result = notes(
    repo(["1.0.0-alpha.1", "1.0.0-alpha.2", "1.0.0-alpha.3", "1.0.0-alpha.4"], 1),
  );
  expect(result.versions).toEqual(["1.0.0-alpha.4", "1.0.0-alpha.3", "1.0.0-alpha.2"]);
});

test("the first release takes the whole changelog", () => {
  // No earlier tag, so `git describe` exits non-zero. That is the answer rather than a
  // failure: a repository's first release has no predecessor to exclude.
  const result = notes(repo(["1.0.0-alpha.1"], 0));
  expect(result.versions).toEqual(["1.0.0-alpha.1"]);
});
