import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { missingAddonMessage, unloadableAddonMessage } from "./addon-error";
import type { VentiAddon } from "./native";

export type { VentiAddon } from "./native";

const require = createRequire(import.meta.url);

/// A packaged install has only `dist`; a checkout has the build output first, because a
/// developer working in the tree wants the freshly built artifact rather than a stale copy
/// `tsdown` copied earlier.
const candidatePaths = [
  ["zig-out", "lib", "ventijs.node"],
  ["dist", "ventijs.node"],
];

function findPackageRoot(start: string): string | undefined {
  let current: string | undefined = start;
  while (current !== undefined) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    current = parent === current ? undefined : parent;
  }
  return undefined;
}

function resolveAddonPath(): string {
  const root = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  for (const parts of candidatePaths) {
    if (root === undefined) continue;
    const candidate = join(root, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(missingAddonMessage(root, platform, arch));
}

let addon: VentiAddon | undefined;

/// Lazy on purpose: importing ventijs must not fail for a program that never opens a
/// socket, and the load is a filesystem lookup plus a `dlopen`. A caller who imports the
/// package, gets a `SyntaxError` about a missing binary, and never finds out that the
/// library works fine is a worse first impression than a load on first use.
export function loadAddon(): VentiAddon {
  if (addon !== undefined) return addon;
  const path = resolveAddonPath();
  try {
    addon = require(path) as VentiAddon;
  } catch (cause) {
    // The raw error for an artifact that exists and will not `dlopen` is a symbol the
    // caller has never heard of, from a file they did not know existed.
    throw Object.assign(new Error(unloadableAddonMessage(path, platform, arch)), { cause });
  }
  return addon;
}
