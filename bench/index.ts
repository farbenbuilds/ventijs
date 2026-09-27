import cluster from "node:cluster";
import { runWorker } from "./echo/worker.ts";
import { renderReport } from "./support/format.ts";
import { collectSamples } from "./support/orchestrator.ts";
import { USAGE } from "./support/usage.ts";
import { parseOptions } from "./support/options.ts";
import { buildPlan } from "./support/plan.ts";
import { buildReport, writeReport } from "./support/report.ts";
import { captureProvenance } from "./support/provenance.ts";

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const runPrimary = async (argv: readonly string[]): Promise<number> => {
  const options = parseOptions(argv);
  if (options.help) {
    log(USAGE);
    return 0;
  }
  log(`ventijs echo benchmark: ${options.messages} round trips per sample`);
  const provenance = captureProvenance();
  const samples = await collectSamples(buildPlan(options), { bench: options, log });
  const report = buildReport(options, provenance, samples);
  writeReport(report, options.reportPath);
  log("");
  log(renderReport(report, options.gate));
  log("");
  log(`report written to ${options.reportPath}`);
  return options.gate && report.gate.failed ? 1 : 0;
};

// A malformed flag, a missing `dist`, and a missing tool are different
// problems with the same consequence, so they all land on one non-zero exit
// with the reason on stderr and no fabricated number in the report.
const main = async (): Promise<number> => {
  try {
    if (cluster.isPrimary) return await runPrimary(process.argv.slice(2));
    await runWorker();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bench: ${message}\n`);
    return 2;
  }
};

process.exitCode = await main();
