// The release pipeline is a chain of hand-offs between a maintainer's tag and the
// registry, and every link is a string in a YAML file rather than a call a compiler sees.
// The bug this repository has shipped repeatedly is a fact stated twice, one not in
// effect: a page for an unpublished version advertises an install that fails, a second
// trigger is a way in nothing uses, and a prerelease that is not marked as one reads as
// the newest stable thing.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const WORKFLOW = readFileSync(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);

/// The publish job alone, because the assertions below must name it, not the jobs above it.
const publishJob = WORKFLOW.slice(
  WORKFLOW.indexOf("\n  publish:"),
  WORKFLOW.indexOf("\n  release:"),
);

/// The release job alone, so a permission assertion cannot be satisfied by the publish job above.
const job = WORKFLOW.slice(WORKFLOW.indexOf("\n  release:"));
const header = job.slice(0, job.indexOf("steps:"));

test("the tag is the only way to start a release", () => {
  // Compared as a whole block: a second key under `on:`, a second trigger, or a dispatch
  // input all break the equality, where a substring check would not.
  const trigger = WORKFLOW.slice(WORKFLOW.indexOf("\non:"), WORKFLOW.indexOf("permissions:"))
    .replace(/^\s*#.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  expect(trigger).toBe('on: push: tags: - "v*"');
  expect(WORKFLOW).not.toContain("inputs.");
});

test("a release page follows a successful publish", () => {
  expect(header).toContain("needs: [bindings, bindings-musl, publish]");
  expect(header).toContain("needs.publish.result == 'success'");
  expect(header).toContain("startsWith(github.ref, 'refs/tags/v')");
});

test("the release job cannot publish", () => {
  // Matched as a block: the comment above it contains the same words, and a deleted
  // `permissions:` key would otherwise still satisfy a substring check.
  expect(header).toMatch(/permissions:\n\s+contents: write/);
  expect(header).not.toContain("id-token");
});

test("the OIDC grant sits on the publish job alone", () => {
  expect(publishJob).toContain("id-token: write");
  expect(WORKFLOW.slice(0, WORKFLOW.indexOf("\n  publish:"))).not.toContain("id-token");
  expect(job).not.toContain("id-token");
});

test("the publish job installs the npm client trusted publishing lives in", () => {
  // `pnpm/setup` strips the bundled npm from the Node runtime, so without this the runner
  // image's npm 10 runs the publish and every attempt fails ENEEDAUTH.
  expect(publishJob).toContain("pnpm add -g npm@^12");
  expect(publishJob).toContain("npm --version");
});

test("the publish job stages and publishes the six packages", () => {
  expect(publishJob).toContain("actions/download-artifact@v4");
  expect(publishJob).toContain("node scripts/check-release-tag.mjs");
  expect(publishJob).toContain("pnpm run stage:publish");
  expect(publishJob).toContain("pnpm exec napi-zig publish");
});

test("every release is promoted to the latest dist-tag", () => {
  // A prerelease publishes under its preid tag from `napi-zig`, so the promotion is a step
  // of its own. It uses the job's OIDC token once the trusted publisher allows tag
  // management; a stored npm secret would be the alternative and is not there.
  expect(publishJob).toContain("npm dist-tag add");
  expect(publishJob).toContain('"ventiws@${TAG#v}" latest');
  expect(publishJob).not.toContain("NPM_TOKEN");
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
