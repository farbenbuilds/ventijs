//! The published platform set is stated in the build graph, in the loader, and in the
//! release workflow, and none of the three can import the others. Most pairs are already
//! covered where a mistake surfaces: a workflow entry the graph does not know is a
//! configure-time fatal from `platforms.resolve`, and a graph entry no runner builds is a
//! release-time failure from `stage-publish.mjs`. The pair nothing covers is the graph
//! against the loader, so that is what this holds.

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { PUBLISHED_TARGETS } from "../../src/binding/target";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const PLATFORMS_ZIG = read("src/builds/platforms.zig");
const PUBLISH_YML = read(".github/workflows/publish.yml");
const BINDINGS_SCRIPT = read("scripts/build-bindings.mjs");
const GITIGNORE = read(".gitignore");

/// `napi_zig.Platform` spells its members the way Zig does and the published package names
/// spell them the way npm does, so the two differ by a fixed renaming rather than by a list
/// either file repeats. Deriving it here is the point: a platform is added once to
/// `published`, and this conversion is the whole of the translation.
const RENAME: Record<string, string> = { macos: "darwin", windows: "win32" };

function toSuffix(member: string): string {
  return member
    .split("_")
    .map((part, index) => (index === 0 && part in RENAME ? RENAME[part] : part))
    .join("-");
}

function buildGraphTargets(): string[] {
  const block = PLATFORMS_ZIG.match(/pub const published = \[_]napi_zig\.Platform\{([^}]*)\}/);
  if (block === null)
    throw new Error("platforms.zig no longer declares a `published` platform list");
  return [...block[1].matchAll(/\.([a-z0-9_]+),/g)].map((match) => toSuffix(match[1]));
}

type Shard = { readonly os: string; readonly platform: string };

/// One entry per `platform:` the workflow schedules, paired with the `os:` above it.
/// Parsed as pairs rather than as two independent scans so the runner is bound to its
/// platform, which is the whole of the next test.
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

test("the build graph and the loader agree on the published set", () => {
  // A member in one and not the other is either a package nobody installs or a host with
  // no binary and no published list to read, so both directions are asserted.
  expect(buildGraphTargets().sort()).toEqual([...PUBLISHED_TARGETS].sort());
});

test("every published platform is built by a runner in the release workflow", () => {
  // The schedule is what decides which platform is compiled; a target with no matrix
  // entry is a package the graph declares, the release fails on, and no user gets.
  expect(scheduledTargets()).toEqual([...PUBLISHED_TARGETS].sort());
});

test("each platform is built on a runner that is native for it", () => {
  // The engine builds its vendored archives for the host target, so a cross-compiled
  // addon links a foreign BoringSSL. It links, and it then misbehaves, which is the one
  // failure a green pipeline cannot catch, so the pairing has to be right in the file.
  const family: Record<string, string> = { linux: "ubuntu-", darwin: "macos-", win32: "windows-" };
  const shards = scheduledShards();
  expect(shards.length).toBeGreaterThan(0);
  for (const shard of shards) {
    const expected = family[shard.platform.split("-")[0] ?? ""] ?? "!";
    expect(shard.os.startsWith(expected)).toBe(true);
  }
});

test("the musl platform is built in a musl container, not on a glibc runner", () => {
  // A musl target compiled by a glibc host links glibc archives into an Alpine binary,
  // and only the release job would have shown it. Read as one job rather than as two
  // substrings, because the pairing is the claim: a musl container elsewhere in the file
  // would satisfy two independent `toContain` checks and mean nothing.
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

test("the staged packages are build output, not source", () => {
  // Split on the line ending the host wrote: a gate that only reads LF would fail on the
  // platform it is meant to protect.
  expect(GITIGNORE.split(/\r?\n/)).toContain("npm/");
});
