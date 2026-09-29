#!/usr/bin/env node
// Builds the per-platform addon packages and stages them under `npm/` for publishing.
//
// The napi-zig CLI's own `build --release` cross-compiles every platform in
// `.npm.platforms` in one go. That cannot be used for a release here: Zig ships no
// Apple SDK, so the darwin targets fail to link on a Linux runner, and one runner
// would build five copies of BoringSSL and lsquic to get there. This drives `zig build`
// with `-Dnpm-platform` instead, so a release job builds the platforms its own runner
// can and `publish.yml` publishes the union of the shards.
//
// `zig-out/npm/` is the toolchain's staging area and `npm/` is the publishable tree;
// both are the same shape, so the mirror is a copy rather than a re-scaffold. The
// toolchain's `binding.js` and `index.js` are left in place: `napi-zig publish` walks
// `npm/` for manifests and ignores them, and `stage-publish.mjs` drops them from the
// main package because TypeScript owns that surface.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ADDON = "ventiws";
const SCOPE_DIR = "@ventiws";

function parsePlatforms(argv) {
  const flag = argv.find((arg) => arg.startsWith("--platform="));
  return flag === undefined ? undefined : flag.slice("--platform=".length);
}

function run(command, args) {
  // A shell on win32 only, so `zig` resolves the same way it does in a developer's
  // shell there; on every other platform the exec form keeps the args unquoted.
  const shell = process.platform === "win32";
  const result = spawnSync(command, args, { stdio: "inherit", shell });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
}

function main() {
  const platforms = parsePlatforms(process.argv.slice(2));
  const args = ["build", "-Dnpm=true", "--release=fast"];
  // The scope is repeated in the staging path rather than read from the build graph, so
  // the two have to agree; `tests/tooling/publish-platforms.test.ts` holds them together.
  if (platforms !== undefined) args.push(`-Dnpm-platform=${platforms}`);
  run("zig", args);

  const staged = join("zig-out", "npm", ADDON);
  if (!existsSync(join(staged, SCOPE_DIR))) {
    throw new Error(`no ${SCOPE_DIR} binding under ${staged}; the npm scaffold did not run`);
  }
  const publishable = join("npm", ADDON);
  rmSync(publishable, { recursive: true, force: true });
  mkdirSync(publishable, { recursive: true });
  cpSync(staged, publishable, { recursive: true });

  for (const target of readdirSync(join(publishable, SCOPE_DIR)).sort()) {
    console.log(`build-bindings: staged ${SCOPE_DIR}/binding-${target}`);
  }
}

main();
