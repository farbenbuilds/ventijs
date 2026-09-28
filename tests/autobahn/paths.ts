import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/// Every path is anchored to this file, not the process working directory, which differs between the container and CI.
const HERE = dirname(fileURLToPath(import.meta.url));

/// The `agent` key the fuzzing client writes into `index.json`; it must match the config, which nests the report under it.
export const AGENT = "ventijs";

/// The client URL is static JSON, so the port is a known value rather than the ephemeral one the target reports.
export const DEFAULT_TARGET_PORT = 9001;
export const DEFAULT_TARGET_HOST = "0.0.0.0";

/// `wstest` resolves `outdir` inside the container, so it must be the mount point and not a host path.
export const CONTAINER_CONFIG_PATH = "/fuzzingclient.json";
export const CONTAINER_REPORTS_DIR = "/reports";

/// Read-only config and a writable report directory, one configuration per suite mode: the framing mode omits the two per-message-deflate groups.
export const CONFIG_HOST_PATH = join(HERE, "fuzzingclient.json");
export const CONFIG_FRAMING_HOST_PATH = join(HERE, "fuzzingclient-framing.json");
export const REPORTS_HOST_DIR = join(HERE, "reports");
export const REPORT_INDEX_HOST_PATH = join(REPORTS_HOST_DIR, "servers", "index.json");
export const SUMMARY_HOST_PATH = join(REPORTS_HOST_DIR, "summary.json");

/// A sharded run gives every shard its own report tree and spec, so two containers cannot write
/// into the same bind mount; a single shard keeps the unsplit layout.
export function shardReportsDir(id: number): string {
  return join(REPORTS_HOST_DIR, `shard-${id}`);
}

export function shardSpecPath(id: number): string {
  return join(shardReportsDir(id), "fuzzingclient.json");
}

export function shardReportIndexPath(id: number): string {
  return join(shardReportsDir(id), "servers", "index.json");
}

export const PACKAGE_ROOT = resolve(HERE, "..", "..");
export const TARGET_ENTRY_PATH = join(HERE, "target.ts");
