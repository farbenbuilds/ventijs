import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/// The contract name in `CI_CD_PIPELINE.md`. A report without it cannot be
/// compared against a stored baseline, because the column set may have moved.
export const SCHEMA_VERSION = "ventiws-ws-compare/3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Provenance = {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly gitCommit: string;
  readonly gitDirty: boolean;
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
  readonly zigVersion: string;
  readonly lockfileSha256: string;
  readonly ventiwsVersion: string;
  readonly wsVersion: string;
  readonly uwebSocketsVersion: string;
  readonly socketIoVersion: string;
  readonly socketIoClientVersion: string;
  readonly nodeAbi: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
};

const UNKNOWN = "unavailable";

// Provenance commands are allowed to fail: a missing tool is itself provenance.
const capture = (command: string, args: readonly string[]): string => {
  try {
    return execFileSync(command, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return UNKNOWN;
  }
};

const readPackageVersion = (relativePath: string): string => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return UNKNOWN;
    const version = (parsed as Record<string, unknown>).version;
    return typeof version === "string" ? version : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
};

const hashLockfile = (): string => {
  try {
    return createHash("sha256")
      .update(readFileSync(join(ROOT, "pnpm-lock.yaml")))
      .digest("hex");
  } catch {
    return UNKNOWN;
  }
};

export const captureProvenance = (): Provenance => {
  const processors = cpus();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    gitCommit: capture("git", ["rev-parse", "HEAD"]) || UNKNOWN,
    gitDirty: capture("git", ["status", "--porcelain"]) !== "",
    nodeVersion: process.versions.node,
    pnpmVersion: capture("pnpm", ["--version"]),
    zigVersion: capture("zig", ["version"]),
    lockfileSha256: hashLockfile(),
    ventiwsVersion: readPackageVersion("package.json"),
    wsVersion: readPackageVersion("node_modules/ws/package.json"),
    uwebSocketsVersion: readPackageVersion("node_modules/uWebSockets.js/package.json"),
    socketIoVersion: readPackageVersion("node_modules/socket.io/package.json"),
    socketIoClientVersion: readPackageVersion("node_modules/socket.io-client/package.json"),
    // The ABI is what selects the uWebSockets.js prebuilt, so a Node upgrade
    // that silently drops a reference leg is visible in the report.
    nodeAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    cpuModel: processors[0]?.model ?? UNKNOWN,
    cpuCount: processors.length,
    totalMemoryBytes: totalmem(),
  };
};
