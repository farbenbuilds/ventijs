import { arch, platform } from "node:process";
import { hostLibc } from "./host-libc";
import type { HostLibc } from "./host-libc";

/// A published install-time contract: renaming one of these suffixes breaks every
/// installed copy that resolves it, so an unbuilt target is absent rather than misspelled.
export type AddonTarget =
  | "linux-x64-gnu"
  | "linux-arm64-gnu"
  | "linux-x64-musl"
  | "darwin-x64"
  | "darwin-arm64";

/// The npm scope the binding packages live under. A name prefix, not a directory.
export const ADDON_SCOPE = "@ventiws";

/// Every target `src/builds/platforms.zig` builds; the loader cannot ask the build
/// graph, so `tests/tooling/publish-platforms.test.ts` holds this copy to that list.
export const PUBLISHED_TARGETS: readonly AddonTarget[] = [
  "linux-x64-gnu",
  "linux-arm64-gnu",
  "linux-x64-musl",
  "darwin-x64",
  "darwin-arm64",
];

/// The package carrying the addon for `target`, e.g. `@ventiws/binding-darwin-arm64`.
export function bindingPackageName(target: AddonTarget): string {
  return `${ADDON_SCOPE}/binding-${target}`;
}

/// `undefined` separates "this platform has no binary, so read the published list" from
/// "the binary is here and will not load", which have different remedies. Darwin takes
/// no libc suffix because its addons link the system libc.
export function addonTarget(
  nodePlatform: string,
  nodeArch: string,
  libc: HostLibc,
): AddonTarget | undefined {
  if (nodePlatform === "darwin") return darwinTarget(nodeArch);
  // Windows resolves to nothing: the pinned toolchain cannot link a Windows target.
  if (nodePlatform !== "linux") return undefined;
  if (nodeArch === "x64") return `linux-x64-${libc}`;
  // Alpine arm64 is not built, so musl arm64 resolves to nothing.
  if (nodeArch === "arm64" && libc === "gnu") return "linux-arm64-gnu";
  return undefined;
}

function darwinTarget(nodeArch: string): AddonTarget | undefined {
  if (nodeArch === "x64") return "darwin-x64";
  if (nodeArch === "arm64") return "darwin-arm64";
  return undefined;
}

export function hostAddonTarget(): AddonTarget | undefined {
  return addonTarget(platform, arch, hostLibc());
}
