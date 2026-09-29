//! The release pipeline is a chain of hand-offs between two workflows, and every link is a
//! string in a YAML file rather than a call a compiler sees. The bug all five share is the
//! one this repository has shipped three times: a fact stated twice, one not in effect. A
//! page for an unpublished version advertises an install that fails; a `push`-only gate skips
//! the page on every release, because `bump.yml` dispatches at the tag; an `id-token` in the
//! release job would let the job that writes a page also publish; a bare tag does not say
//! which package it is; and an unmarked prerelease reads as the newest stable thing.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const WORKFLOW = readFileSync(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);

/// The release job alone, so a permission assertion cannot be satisfied by the publish job
/// above it, which legitimately holds `id-token` and must.
const job = WORKFLOW.slice(WORKFLOW.indexOf("\n  release:"));
const header = job.slice(0, job.indexOf("steps:"));

test("a release page follows a successful publish", () => {
  expect(WORKFLOW).toContain("needs: [bindings, bindings-musl, publish]");
  expect(header).toContain("needs.publish.result == 'success'");
  expect(header).toContain("startsWith(github.ref, 'refs/tags/v')");
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
