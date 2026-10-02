import process from "node:process";

/// The runtimes a binding is resolved for. `unknown` keeps any other N-API host on the
/// Node path, because a host that can load the addon exposes a Node-shaped `process`.
export type RuntimeName = "node" | "bun" | "deno" | "unknown";

type RuntimeGlobals = {
  Bun?: { version?: string };
  Deno?: { version?: { deno?: string }; build?: { env?: string; target?: string } };
};

export function runtimeGlobals(): RuntimeGlobals {
  return globalThis as RuntimeGlobals;
}

/// Deno reports a Node-compatible `process.versions.node` and a `process` global, so the
/// runtime keys are read before `node` is; the globals are checked too because a bundler
/// can carry one over its `node:process` shim.
export function runtimeName(): RuntimeName {
  const versions: Record<string, string | undefined> = process.versions;
  const globals = runtimeGlobals();
  if (globals.Deno !== undefined || versions.deno !== undefined) return "deno";
  if (globals.Bun !== undefined || versions.bun !== undefined) return "bun";
  if (versions.node !== undefined) return "node";
  return "unknown";
}
