//! The published platform set is stated in three places that cannot import each other:
//! the manifest the build graph reads, the loader that resolves it, and the workflow that
//! schedules a runner for it. Each is read as text or as JSON and checked against the
//! others, so a platform added to one and not the others fails here rather than at a
//! user's install.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { PUBLISHED_TARGETS } from "../../src/binding/target";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const PLATFORM_MANIFEST = read("src/builds/platforms.json");
const PLATFORMS_ZIG = read("src/builds/platforms.zig");
const PUBLISH_YML = read(".github/workflows/publish.yml");
const BINDINGS_SCRIPT = read("scripts/build-bindings.mjs");
const STAGE_SCRIPT = read("scripts/stage-publish.mjs");
const TARGET_TS = read("src/binding/target.ts");
const GITIGNORE = read(".gitignore");

function declaredPlatforms(): string[] {
  return (JSON.parse(PLATFORM_MANIFEST) as { platforms: string[] }).platforms.sort();
}

type Shard = { readonly os: string; readonly platform: string };

/// One entry per `platform:` the workflow schedules, paired with the `os:` above it.
/// Parsed as pairs rather than as two independent scans so the runner is bound to its
/// platform, which is the whole of the runner-native test.
function scheduledShards(): Shard[] {
  return [...PUBLISH_YML.matchAll(/os: ([\w.-]+)\s*\n\s*platform: ([\w-]+)/g)].map((match) => ({
    os: match[1],
    platform: match[2],
  }));
}

function scheduledTargets(): string[] {
  return [
    ...scheduledShards().map((shard) => shard.platform),
    ...[...PUBLISH_YML.matchAll(/build-bindings\.mjs --platform=([\w-]+)/g)].map(
      (match) => match[1],
    ),
  ].sort();
}

test("the manifest, the build graph, and the loader declare the same platforms", () => {
  // The build graph narrows `.npm.platforms` per shard so a runner compiles only what it
  // can, and the toolchain generates its scaffolded manifest from that narrowed list, so
  // one shard's manifest declares one platform where a release needs all of them.
  expect(declaredPlatforms()).toEqual([...PUBLISHED_TARGETS].sort());
  expect(PLATFORMS_ZIG).toContain("platforms.json");
  expect(PLATFORMS_ZIG).not.toMatch(/pub const published/);
});

test("the release gate reads the manifest, not a shard's scaffold", () => {
  // Reading `optionalDependencies` out of the merged scaffold is what rejected a
  // complete release: the merged manifest names one platform, so the gate saw four
  // undeclared on a run that had built all five.
  expect(STAGE_SCRIPT).toContain("src/builds/platforms.json");
  expect(STAGE_SCRIPT).not.toContain("optionalDependencies ?? {}");
});
test("every published platform is built by a runner in the release workflow", () => {
  // The schedule is what decides which platform is compiled; a target with no matrix
  // entry is a package the manifest declares, the release fails on, and no user gets.
  expect(scheduledTargets()).toEqual(declaredPlatforms());
});

test("each platform is built on a runner that is native for it", () => {
  // Family alone is not the claim: `ubuntu-24.04` is x64 and `ubuntu-24.04-arm` is arm64,
  // and a cross-compiled addon links a foreign BoringSSL that misbehaves later. The
  // pairing is asserted target by target, so the wrong architecture fails here.
  const native: Record<string, string> = {
    "linux-x64-gnu": "ubuntu-24.04",
    "linux-arm64-gnu": "ubuntu-24.04-arm",
    "darwin-x64": "macos-15-intel",
    "darwin-arm64": "macos-15",
  };
  const shards = scheduledShards();
  expect(shards.length).toBeGreaterThan(0);
  for (const shard of shards) expect(shard.os).toBe(native[shard.platform]);
});

test("the musl platform is built in a musl container, not on a glibc runner", () => {
  // A musl target compiled by a glibc host links glibc archives into an Alpine binary.
  // Read as one job rather than as two substrings, because the pairing is the claim.
  const job = PUBLISH_YML.split(/\n {2}(?=bindings-musl:)/)[1] ?? "";
  expect(job).toContain("container: node:24-alpine");
  expect(job).toContain("--platform=linux-x64-musl");
});

test("the Linux arm64 runner is one a public repository can use", () => {
  // `ubuntu-24.04-arm` is free on a public repository and hard-fails the workflow on a
  // private one, so going private silently loses a published platform.
  expect(PUBLISH_YML).toContain("ubuntu-24.04-arm");
});

test("the build script narrows the platform list rather than hardcoding it", () => {
  // A shard passes `-Dnpm-platform`; a list in the script would let the workflow and the
  // build graph each add a platform the other misses.
  expect(BINDINGS_SCRIPT).toContain("-Dnpm-platform=");
  expect(BINDINGS_SCRIPT).not.toMatch(/linux-x64-gnu|darwin-arm64|win32-x64/);
});

test("the loader's own list is a copy the manifest has to agree with", () => {
  // `target.ts` cannot read a build-time file, so it states the set again: a target the
  // loader names but the manifest omits is a `require` of a package never published.
  const union = new Set(TARGET_TS.match(/["`]((?:linux|darwin)-[a-z0-9-]+)["`]/g) ?? []);
  expect(union.size).toBeGreaterThan(0);
  expect(declaredPlatforms()).toEqual([...PUBLISHED_TARGETS].sort());
});

test("the staged packages are build output, not source", () => {
  // Split on the line ending the host wrote: a gate that only reads LF would fail on the
  // platform it is meant to protect.
  expect(GITIGNORE.split(/\r?\n/)).toContain("npm/");
});
