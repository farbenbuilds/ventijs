#!/usr/bin/env node
// Emits the release notes for a tag: the changelog sections no earlier tag has claimed.
//
// The changelog is written one section per merge, so a release covers a range of versions
// rather than one. Reading the notes off the changelog rather than regenerating them from
// the commit log keeps the two from disagreeing, which is the failure a second generator
// invites: same commits, two histories, one of them stale.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

const CHANGELOG = "CHANGELOG.md";

/// The version the newest tag before this one released, or null when this is the first.
///
/// The parent rather than the tagged commit itself: at the tagged commit, `describe` finds
/// this release's own tag, which would make every section look already claimed and produce
/// empty notes for the first release of a tag.
export function previousRelease() {
  const found = execFileSync("git", ["describe", "--tags", "--abbrev=0", "HEAD^"], {
    encoding: "utf8",
  });
  return found.trim().replace(/^v/, "");
}

/// Every changelog section, newest first, as a `[version, text]` pair.
///
/// `text` is the heading and body exactly as written, sliced between headings rather than
/// re-rendered from a parsed version. A release page that reformats the changelog has
/// already lost something: the date on every heading here, and any wording a maintainer
/// chose for a section. The changelog is the record and the release page quotes it.
function sections(changelog) {
  const heads = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)];
  return heads.map((head, index) => {
    const end = heads[index + 1]?.index ?? changelog.length;
    return [head[1], changelog.slice(head.index, end)];
  });
}

/// The sections above `previous`, which is what this release introduces.
///
/// A missing `previous` takes every section: the first release has nothing to exclude, and
/// a tag whose predecessor is not in the changelog is a repository whose history was
/// rewritten, where dropping notes silently is worse than showing old ones.
export function notesBetween(changelog, previous) {
  const found = sections(changelog);
  const end =
    previous === null ? found.length : found.findIndex(([version]) => version === previous);
  return end === -1 ? found : found.slice(0, end);
}

function main() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  let previous = null;
  try {
    previous = previousRelease();
  } catch {
    // No earlier tag. `git describe` exits non-zero, which is the answer rather than a
    // failure: a repository's first release has no predecessor to exclude.
    process.stderr.write("release-notes: no earlier tag, so every section is included\n");
  }

  const notes = notesBetween(readFileSync(CHANGELOG, "utf8"), previous);
  // Trimmed and rejoined with one blank line between sections: the slice carries the
  // trailing blank line of the section before it, which would otherwise double up.
  const body = notes.map(([, text]) => text.trim()).join("\n\n");
  const text =
    body === "" ? `No changelog entries between ${previous} and ${version}.\n` : `${body}\n`;

  const out = argv[2];
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text);
  console.error(`release-notes: ${notes.length} sections, up to ${notes[0]?.[0] ?? "none"}`);
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) main();
