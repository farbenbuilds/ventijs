import { createRequire } from "node:module";
import process from "node:process";
import { runtimeName } from "./runtime";
import type { VentiAddon } from "./native";

const require = createRequire(import.meta.url);

/// Deno's documented form passes an explicit flag; Node and Bun accept and ignore it.
const DLOPEN_FLAGS = 0;

/// Deno's documented route to a precompiled N-API addon is `process.dlopen`, and a
/// permission failure through `require` names the CJS loader rather than `--allow-ffi`.
/// Node and Bun keep `require`, which is how the platform packages already resolve.
export function openAddon(path: string): VentiAddon {
  if (runtimeName() === "deno") return denoAddon(path);
  return require(path) as VentiAddon;
}

function denoAddon(path: string): VentiAddon {
  const addon: { exports: VentiAddon } = { exports: {} as VentiAddon };
  process.dlopen(addon, path, DLOPEN_FLAGS);
  return addon.exports;
}
