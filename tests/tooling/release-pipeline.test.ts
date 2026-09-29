//! The release pipeline is a chain of hand-offs between two workflows, and every link is a
//! string in a YAML file rather than a call a compiler sees. The bug they all share is the one
//! this repository has shipped repeatedly: a fact stated twice, one not in effect. A page for an
//! unpublished version advertises an install that fails; a `push`-only gate skips it on every
//! release, because `bump.yml` dispatches at the tag; an `id-token` in the release job would let
//! the job that writes a page also publish; a bare tag does not name its package; and a boolean
//! input compared as a string is a condition that is never taken, so the flag does nothing.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const WORKFLOW = readFileSync(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);

/// The release job alone, so a permission assertion cannot be satisfied by the publish job above.
const job = WORKFLOW.slice(WORKFLOW.indexOf("\n  release:"));
const header = job.slice(0, job.indexOf("steps:"));

test("a release page follows a successful publish", () => {
  expect(WORKFLOW).toContain("needs: [bindings, bindings-musl, publish]");
  expect(header).toContain("needs.publish.result == 'success'");
  expect(header).toContain("startsWith(github.ref, 'refs/tags/v')");
});

test("a dry run writes no release page", () => {
  // `needs.publish.result` is the *job*, and a dry run skips only the publish *step*, so the
  // job still reports success. Without its own dry-run guard the page is written for a version
  // that never reached npm, which is the outcome the comment above it forbids. Asserting the
  // condition's text was not enough: the previous test passed while this was true.
  expect(header).toContain("inputs.dry-run");
  expect(header).toContain("!cancelled()");
  // Mirrored from the publish step, so the two cannot disagree about what a dry run is.
  const publish = WORKFLOW.slice(0, WORKFLOW.indexOf("\n  release:"));
  expect(publish).toContain("inputs.dry-run");
});

test("the release job accepts a dispatch, because that is how it is started", () => {
  expect(header).toContain("github.event_name == 'workflow_dispatch'");
});

test("the release job cannot publish", () => {
  expect(header).toContain("contents: write");
  expect(header).not.toContain("id-token");
});

test("the page names the package and is tagged with the version", () => {
  expect(job).toContain("PKG: ventiws");
  expect(job).toContain('--title "$PKG $TAG"');
  expect(job).toContain('gh release create "$TAG"');
});

test("a prerelease is marked as one", () => {
  expect(job).toContain('[[ "$TAG" == *-* ]]');
  expect(job).toContain("--prerelease");
});

test("a boolean dispatch input is tested as a boolean", () => {
  // A `type: boolean` input compared as a string is *always* false, so the flag does nothing and
  // a dry run publishes for real. Only `if:` lines are read: the comment quoting this pattern
  // is the reason a whole-file search would report the file itself.
  const conditions = WORKFLOW.split("\n").filter((line) => line.trimStart().startsWith("if:"));
  expect(conditions.length).toBeGreaterThan(0);
  for (const line of conditions) expect(line).not.toMatch(/inputs\.[\w-]+\s*==\s*'true'/);
});
