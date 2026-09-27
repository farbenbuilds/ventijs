import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { EngineEvent, VentiAddon } from "../../src/binding/native.ts";
import { PACKAGE_ROOT } from "./paths.ts";

/// `src/binding` uses extensionless relative imports, which Node's type
/// stripping cannot resolve at runtime; only the ABI declaration is reused
/// here, and it is erased before execution. The addon itself is loaded the way
/// `src/binding/load.ts` loads it, with the same candidate order, so the target
/// and the unit tests exercise the same artifact.
const CANDIDATE_PATHS = [
  ["zig-out", "lib", "ventijs.node"],
  ["dist", "ventijs.node"],
] as const;

const require = createRequire(import.meta.url);

function resolveAddonPath(): string {
  for (const parts of CANDIDATE_PATHS) {
    const candidate = join(PACKAGE_ROOT, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `ventijs: native addon not found under ${PACKAGE_ROOT}; run "pnpm build:binding" first`,
  );
}

let addon: VentiAddon | undefined;

export function loadVentijsAddon(): VentiAddon {
  addon ??= require(resolveAddonPath()) as VentiAddon;
  return addon;
}

export type { EngineEvent, VentiAddon };
