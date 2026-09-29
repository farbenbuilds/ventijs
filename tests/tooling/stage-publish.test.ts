//! `stage-publish.mjs` is the gate that stops a release publishing a platform nobody
//! can install, and it is the one script in the release path with no coverage. It reads
//! the scaffolded manifest and the laid-down directories and compares them, so the way
//! it names a target on each side is the whole of its correctness: a build that laid
//! down every platform reported all five missing when the two spellings differed. These
//! run it for real, in a temporary tree, so the comparison is exercised rather than
//! described.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/stage-publish.mjs", import.meta.url));
const SCOPE = "@ventiws";
const VERSION = "9.9.9";
const BINDING = "binding-";

/// The real published set, read rather than restated: the script resolves it relative to
/// its own URL and so always reads the repository's manifest, which means a test that
/// invents its own list would be asserting against a gate that was told to fail.
const TARGETS = (
  JSON.parse(readFileSync(new URL("../../src/builds/platforms.json", import.meta.url), "utf8")) as {
    platforms: string[];
  }
).platforms;

/// A tree shaped like the publish job assembles it: the scaffolded manifest, one
/// directory per platform, and the bundle `tsdown` produced. `built` overrides which
/// platforms actually have a directory, which is how a failed shard looks.
function scaffold(built: readonly string[] = TARGETS): string {
  const root = mkdtempSync(join(tmpdir(), "ventiws-stage-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "ventiws", version: VERSION, scripts: { build: "x" } }),
  );

  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "index.mjs"), "export {};\n");

  const stage = join(root, "npm", "ventiws");
  mkdirSync(join(stage, SCOPE), { recursive: true });
  // A shard's scaffolded manifest declares only the platform that shard built, which is
  // what the toolchain generates from a narrowed `.npm.platforms`; the gate must not
  // learn the release's platform set from it.
  writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "ventiws" }));
  for (const target of built) {
    const dir = join(stage, SCOPE, `${BINDING}${target}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "ventiws.node"), "not a real addon");
  }
  return root;
}

function run(root: string): { readonly code: number; readonly out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

function stagedManifest(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "npm", "ventiws", "package.json"), "utf8"));
}

test("a complete tree stages, and every platform reaches the manifest", () => {
  // The regression this file exists for: the manifest names a target and the directory
  // carries a `binding-` prefix, and comparing the two spellings reported every platform
  // missing on a release that had built all of them.
  const root = scaffold();
  expect(run(root).code).toBe(0);

  const manifest = stagedManifest(root);
  // Pinned to the release rather than the scaffold's `0.0.0`, or npm resolves nothing.
  expect(manifest.version).toBe(VERSION);
  const optional = manifest.optionalDependencies as Record<string, string>;
  expect(optional[`${SCOPE}/binding-${TARGETS[0]}`]).toBe(VERSION);
  expect(Object.keys(optional)).toHaveLength(TARGETS.length);
});

test("a failed shard stops the release and names the platform", () => {
  const result = run(scaffold(TARGETS.slice(0, -1)));
  expect(result.code).not.toBe(0);
  expect(result.out).toContain(`binding-${TARGETS.at(-1)}`);
  expect(result.out).toContain("declared but not built");
});

test("a platform nobody declared is refused rather than published", () => {
  const result = run(scaffold([...TARGETS, "win32-x64"]));
  expect(result.code).not.toBe(0);
  expect(result.out).toContain("win32-x64");
});

test("a directory whose compile produced no addon is refused", () => {
  // A scaffolded directory is not evidence that anything was built for it, so the
  // completeness check has to look at the artifact and not only the name.
  const root = scaffold();
  rmSync(join(root, "npm", "ventiws", SCOPE, `${BINDING}${TARGETS[0]}`, "ventiws.node"));
  const result = run(root);
  expect(result.code).not.toBe(0);
  expect(result.out).toContain("ventiws.node");
});

test("the staged manifest drops what a tarball must not carry", () => {
  const root = scaffold();
  expect(run(root).code).toBe(0);
  const manifest = stagedManifest(root);
  // No build script, so npm cannot run one on install, and nothing that shadows the
  // loader this project actually ships.
  expect(manifest.scripts).toBeUndefined();
  expect(existsSync(join(root, "npm", "ventiws", "binding.js"))).toBe(false);
  expect(existsSync(join(root, "npm", "ventiws", "index.js"))).toBe(false);
  expect(existsSync(join(root, "npm", "ventiws", "dist", "index.mjs"))).toBe(true);
});
