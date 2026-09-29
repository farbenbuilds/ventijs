#!/usr/bin/env node
// Assembles the publishable main package under `npm/ventiws`.
//
// The toolchain's scaffolded main manifest names the addon `ventiws`, lists the
// `@ventiws/binding-*` packages in `optionalDependencies`, and points `main` at a
// generated loader for a surface this project does not ship -- TypeScript owns the
// public API, and the Zig root module's exports are the addon internals behind it.
// So the manifest is written from the repository's own, with the scaffold's
// `optionalDependencies` lifted onto it: that list comes from `.npm.platforms` in the
// build graph, and a hand-maintained copy in `package.json` would drift from what the
// build actually produces.
//
// The version is the repository's, applied to every manifest under `npm/`. The
// scaffold writes `0.0.0` as a placeholder for `napi-zig bump` to fill, and a release
// here is versioned by `pnpm release` instead, so the placeholder is replaced rather
// than left to become the published version of a binding.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ADDON = "ventiws";
const SCOPE_DIR = "@ventiws";
const STAGE = join("npm", ADDON);

/// Repository-only fields. A published manifest carries no build script, no dev
/// toolchain, and no package-manager pin, because nothing in the tarball can run them.
const REPO_ONLY = ["scripts", "devDependencies", "packageManager"];

/// The scaffolded files for the shape this project does not ship. `index.js` and
/// `index.d.ts` re-export the Zig module's own decls, and `binding.js` is a second
/// loader; leaving any of them beside an `exports` map that does not name them is a
/// file a reader can reach and cannot account for.
const SCAFFOLDED = ["index.js", "index.d.ts", "binding.js"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bindingTargets(scaffold) {
  return Object.keys(scaffold.optionalDependencies ?? {})
    .filter((name) => name.startsWith(`${SCOPE_DIR}/binding-`))
    .map((name) => name.slice(`${SCOPE_DIR}/binding-`.length))
    .sort();
}

function builtTargets() {
  const scope = join(STAGE, SCOPE_DIR);
  if (!existsSync(scope)) return [];
  return readdirSync(scope).sort();
}

/// The gate: every platform the build graph declares has a compiled addon here. A shard
/// that failed to upload leaves a declared target with no directory, and publishing the
/// main package without it would ship a version that no Linux arm64 user can install.
function verifyCompleteness(declared, built) {
  const missing = declared.filter((target) => !built.includes(target));
  const extra = built.filter((target) => !declared.includes(target));
  if (missing.length === 0 && extra.length === 0) return;
  for (const target of missing) {
    process.stderr.write(
      `stage-publish: ${SCOPE_DIR}/binding-${target} is declared but not built\n`,
    );
  }
  for (const target of extra) {
    process.stderr.write(
      `stage-publish: ${SCOPE_DIR}/binding-${target} is built but not declared\n`,
    );
  }
  throw new Error(
    `stage-publish: ${missing.length} missing and ${extra.length} undeclared platform packages`,
  );
}

function verifyAddons(targets) {
  for (const target of targets) {
    const addon = join(STAGE, SCOPE_DIR, `binding-${target}`, `${ADDON}.node`);
    if (!existsSync(addon))
      throw new Error(`stage-publish: ${SCOPE_DIR}/binding-${target} has no ${ADDON}.node`);
  }
}

function main() {
  const repo = readJson("package.json");
  const scaffoldPath = join(STAGE, "package.json");
  if (!existsSync(scaffoldPath)) {
    throw new Error(
      `stage-publish: ${scaffoldPath} is missing; run scripts/build-bindings.mjs first`,
    );
  }
  const scaffold = readJson(scaffoldPath);
  const declared = bindingTargets(scaffold);
  const built = builtTargets();
  verifyCompleteness(declared, built);
  verifyAddons(declared);

  if (!existsSync("dist")) {
    throw new Error("stage-publish: dist/ is missing; run tsdown first");
  }
  cpSync("dist", join(STAGE, "dist"), { recursive: true });
  for (const file of SCAFFOLDED) rmSync(join(STAGE, file), { force: true });

  const optional = {};
  for (const target of declared) optional[`${SCOPE_DIR}/binding-${target}`] = repo.version;
  const manifest = { ...repo };
  for (const key of REPO_ONLY) delete manifest[key];
  writeJson(scaffoldPath, { ...manifest, optionalDependencies: optional });

  for (const target of declared) {
    const path = join(STAGE, SCOPE_DIR, `binding-${target}`, "package.json");
    writeJson(path, { ...readJson(path), version: repo.version });
  }
  console.log(`stage-publish: ventiws@${repo.version} with ${declared.length} platform packages`);
  for (const target of declared) console.log(`stage-publish:   ${SCOPE_DIR}/binding-${target}`);
}

main();
