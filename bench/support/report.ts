import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EchoSample } from "../echo/echo-types.ts";
import type { BenchOptions } from "./options.ts";
import { SAMPLE_TIMEOUT_MS, VENTIJS_MAX_MESSAGE_BYTES } from "./options.ts";
import type { ConfigurationResult, GateVerdict } from "./plan.ts";
import { evaluateGate, summarize } from "./plan.ts";
import type { Provenance } from "./provenance.ts";

export type ReportParameters = {
  readonly payloadSizes: readonly number[];
  readonly payloadCeilingBytes: number;
  readonly messages: number;
  readonly repeats: number;
  readonly warmupRepeatsDiscarded: number;
  readonly measuredSamplesPerConfiguration: number;
  readonly timeoutMs: number;
};

/// The `ventijs-ws-compare` artifact. Raw seconds stay in the report next to
/// every median so a reader can recompute the summary instead of trusting it.
export type BenchmarkReport = {
  readonly provenance: Provenance;
  readonly parameters: ReportParameters;
  readonly configurations: readonly ConfigurationResult[];
  readonly gate: GateVerdict;
};

export const buildReport = (
  options: BenchOptions,
  provenance: Provenance,
  samples: readonly EchoSample[],
): BenchmarkReport => {
  const results = summarize(options, samples);
  return {
    provenance,
    parameters: {
      payloadSizes: options.payloadSizes,
      payloadCeilingBytes: VENTIJS_MAX_MESSAGE_BYTES,
      messages: options.messages,
      repeats: options.repeats,
      warmupRepeatsDiscarded: options.warmups,
      measuredSamplesPerConfiguration: options.repeats,
      timeoutMs: SAMPLE_TIMEOUT_MS,
    },
    configurations: results,
    gate: evaluateGate(results),
  };
};

export const writeReport = (report: BenchmarkReport, path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};
