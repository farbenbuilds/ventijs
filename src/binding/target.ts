import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { arch, platform } from "node:process";

/// The suffix of the `@ventiws/binding-*` package for a published target. It is a
/// published contract: those package names are the install-time dispatch, so renaming
/// one breaks every installed copy that resolves it. A target a release does not build
/// is absent, so the loader names only packages that exist: an unsupported host then
/// takes the same path as an unpublished one and is told what there is.
export type AddonTarget =
  | "linux-x64-gnu"
  | "linux-arm64-gnu"
  | "linux-x64-musl"
  | "darwin-x64"
  | "darwin-arm64";

/// The npm scope the binding packages live under. A name prefix, not a directory.
export const ADDON_SCOPE = "@ventiws";

/// Every target `src/builds/platforms.zig` builds. The loader cannot ask the build
/// graph, so this is the second copy of that list; `tests/tooling/publish-platforms.test.ts`
/// holds the two to each other, because a target in one and not the other is either a
/// package nobody installs or a host with no binary and no published list to read.
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

/// The target for a host, or `undefined` when the host is not one a published ventiws
/// ships for. `undefined` is what the loader needs: it separates "this platform has no
/// binary, so read the published list" from "the binary is here and will not load",
/// which are different problems with different remedies, and it is what a Windows host
/// gets today.
export function addonTarget(nodePlatform: string, nodeArch: string): AddonTarget | undefined {
  if (nodePlatform === "darwin") return darwinTarget(nodeArch);
  // Windows resolves to nothing: the pinned toolchain cannot link a Windows target.
  if (nodePlatform !== "linux") return undefined;
  const libc = isMuslLibc() ? "musl" : "gnu";
  if (nodeArch === "x64") return `linux-x64-${libc}`;
  // Alpine arm64 is not built, so musl arm64 resolves to nothing rather than to a
  // package name that was never published.
  if (nodeArch === "arm64" && libc === "gnu") return "linux-arm64-gnu";
  return undefined;
}

function darwinTarget(nodeArch: string): AddonTarget | undefined {
  if (nodeArch === "x64") return "darwin-x64";
  if (nodeArch === "arm64") return "darwin-arm64";
  return undefined;
}

/// Whether this Linux host links musl rather than glibc, which is what separates the two
/// Linux families. `process.report` carries the answer on every supported release, so it
/// is read first and the two probes only answer for a host that does not expose it. The
/// order and the test conditions match the loader `napi-zig` generates for the same
/// decision, because the answer has to name the same published package.
function isMuslLibc(): boolean {
  const facts = reportFacts();
  if (facts?.glibcVersionRuntime !== undefined) return false;
  if (isMuslSharedObject(facts?.sharedObjects)) return true;
  return probeMuslBinary();
}

type ReportFacts = { glibcVersionRuntime?: string; sharedObjects?: string[] };

/// `getReport` is typed as a bare `object` and is a string on some builds, so it is
/// narrowed rather than asserted. A report that will not narrow counts as absent: the
/// probes answer the same question.
function reportFacts(): ReportFacts | undefined {
  if (typeof process.report?.getReport !== "function") return undefined;
  const report = asRecord(asRecord(process.report.getReport()));
  if (report === undefined) return undefined;
  const facts: ReportFacts = {};
  const header = asRecord(report.header);
  const glibc = header?.glibcVersionRuntime;
  if (typeof glibc === "string") facts.glibcVersionRuntime = glibc;
  const objects = report.sharedObjects;
  if (Array.isArray(objects))
    facts.sharedObjects = objects.filter((entry) => typeof entry === "string");
  return facts;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") return parsedJson(value);
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function parsedJson(source: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(source));
  } catch {
    return undefined;
  }
}

function isMuslSharedObject(sharedObjects: string[] | undefined): boolean {
  if (sharedObjects === undefined) return false;
  return sharedObjects.some((entry) => entry.includes("libc.musl-") || entry.includes("ld-musl-"));
}

function probeMuslBinary(): boolean {
  try {
    return readFileSync("/usr/bin/ldd", "utf8").includes("musl");
  } catch {
    return probeLddVersion();
  }
}

function probeLddVersion(): boolean {
  try {
    const output = execFileSync("ldd", ["--version"], { encoding: "utf8" });
    return output.includes("musl");
  } catch {
    return false;
  }
}

export function hostAddonTarget(): AddonTarget | undefined {
  return addonTarget(platform, arch);
}
