import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/// Every path the harness touches is anchored to this file, not to the process
/// working directory. `wstest` runs inside a container and CI invokes the
/// runner from the repository root, so a relative path would resolve to two
/// different places depending on who is asking.
const HERE = dirname(fileURLToPath(import.meta.url));

/// The `agent` key the fuzzing client writes into `index.json`. It must match
/// `fuzzingclient.json`, because the report is nested under this name.
export const AGENT = "ventijs";

/// Default listener for the target. The fuzzing client URL is static JSON, so
/// the port has to be a known value rather than the ephemeral one the target
/// reports; the runner overrides it through the environment.
export const DEFAULT_TARGET_PORT = 9001;
export const DEFAULT_TARGET_HOST = "0.0.0.0";

/// In-container paths. `outdir` in `fuzzingclient.json` is resolved by
/// `wstest` inside the container, so it must be the mount point and not a host
/// path the container cannot see.
export const CONTAINER_CONFIG_PATH = "/fuzzingclient.json";
export const CONTAINER_REPORTS_DIR = "/reports";

/// Host-side paths: the config is mounted read-only, the report directory is
/// mounted writable so repeated local runs replace the previous run's files.
///
/// Two configurations, one per suite mode. `fuzzingclient.json` is the full 517
/// cases; `fuzzingclient-framing.json` omits the two per-message-deflate groups.
/// See `MODE_COUNTS` in `expected-cases.ts` for why the split exists.
export const CONFIG_HOST_PATH = join(HERE, "fuzzingclient.json");
export const CONFIG_FRAMING_HOST_PATH = join(HERE, "fuzzingclient-framing.json");
export const REPORTS_HOST_DIR = join(HERE, "reports");
export const REPORT_INDEX_HOST_PATH = join(REPORTS_HOST_DIR, "servers", "index.json");
export const SUMMARY_HOST_PATH = join(REPORTS_HOST_DIR, "summary.json");

export const PACKAGE_ROOT = resolve(HERE, "..", "..");
export const TARGET_ENTRY_PATH = join(HERE, "target.ts");
