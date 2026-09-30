import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dockerArgs } from "./docker.ts";
import { AGENT } from "./paths.ts";
import { forgetContainer, registerContainer } from "./docker.ts";
import { configFor } from "./paths.ts";
import { exceedsInboundLimit } from "./expected-cases.ts";
import type { SuiteMode } from "./expected-cases.ts";
import { REPORTS_HOST_DIR, REPORT_INDEX_HOST_PATH } from "./paths.ts";
import { parseReportIndex, toCaseReports } from "./report-index.ts";
import type { CaseReport } from "./report-index.ts";
import { shardContainerName } from "./shard-plan.ts";

/// The report directory is wiped first so a stale `index.json` from an earlier
/// run can never be read as this run's evidence.
export function resetReportDirectory(): void {
  rmSync(REPORTS_HOST_DIR, { recursive: true, force: true });
  mkdirSync(REPORTS_HOST_DIR, { recursive: true });
}

function currentUser(): { readonly uid: string; readonly gid: string } {
  return { uid: String(process.getuid?.() ?? 1000), gid: String(process.getgid?.() ?? 1000) };
}

/// Spawns one `wstest` container and resolves with its exit code.
///
/// The child is registered with the cleanup module, which removes the container
/// if this process is interrupted: an orphaned `wstest` outlives `--rm` and would
/// keep writing into a report directory the next run deletes.
export function runContainer(input: {
  readonly configHostPath: string;
  readonly reportsHostDir: string;
  readonly name: string;
}): Promise<number> {
  const argv = dockerArgs({ ...currentUser(), ...input });
  return new Promise((resolve) => {
    const child = spawn("docker", argv, { stdio: "inherit" });
    registerContainer(child, input.name);
    const fail = (code: number, message: string): void => {
      process.stderr.write(`autobahn: ${message}\n`);
      resolve(code);
    };
    child.once("error", (error) => fail(127, `docker failed to start: ${error.message}`));
    child.once("exit", (code, signal) => {
      forgetContainer(child);
      if (signal !== null) {
        fail(128, `wstest terminated by ${signal}`);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

/// Runs the unsplit configuration, which is what every local run and every
/// `AUTOBAHN_SHARDS=1` run uses.
export function runFuzzingClient(mode: SuiteMode): Promise<number> {
  return runContainer({
    configHostPath: configFor(mode),
    reportsHostDir: REPORTS_HOST_DIR,
    name: shardContainerName(0),
  });
}

export function reportExists(): boolean {
  return existsSync(REPORT_INDEX_HOST_PATH);
}

export function readReportCases(): readonly CaseReport[] {
  if (!reportExists()) {
    throw new Error(`autobahn: ${REPORT_INDEX_HOST_PATH} was not written by the suite`);
  }
  const raw = readFileSync(REPORT_INDEX_HOST_PATH, "utf8");
  return toCaseReports(parseReportIndex(raw, AGENT), exceedsInboundLimit);
}
