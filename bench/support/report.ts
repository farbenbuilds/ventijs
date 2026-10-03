import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EchoSample, GateImplementationId, ImplementationId } from "../echo/echo-types.ts";
import { BASELINE_ID, CANDIDATE_ID } from "../echo/echo-types.ts";
import { ECHO_PAYLOAD_CEILING_BYTES } from "../echo/echo-limits.ts";
import type { GateVerdict } from "./gate.ts";
import { evaluateGate } from "./gate.ts";
import type { BenchOptions } from "./options.ts";
import { GATE_MIN_RATIO, SAMPLE_TIMEOUT_MS } from "./options.ts";
import type { Provenance } from "./provenance.ts";
import type { ConfigurationResult } from "./summary.ts";
import { summarize } from "./summary.ts";

export type ReportParameters = {
  readonly payloadSizes: readonly number[];
  readonly payloadCeilingBytes: number;
  readonly messages: number;
  readonly repeats: number;
  readonly warmupRepeatsDiscarded: number;
  readonly measuredSamplesPerConfiguration: number;
  readonly timeoutMs: number;
  readonly implementations: readonly ImplementationId[];
  readonly gateBaseline: GateImplementationId;
  readonly gateCandidate: GateImplementationId;
  readonly gateMinimumRatio: number;
  readonly wireBytesBasis: "payload-only";
};

/// The `ventiws-ws-compare` artifact. Raw seconds stay in the report next to
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
      payloadCeilingBytes: ECHO_PAYLOAD_CEILING_BYTES,
      messages: options.messages,
      repeats: options.repeats,
      warmupRepeatsDiscarded: options.warmups,
      measuredSamplesPerConfiguration: options.repeats,
      timeoutMs: SAMPLE_TIMEOUT_MS,
      implementations: options.implementations,
      gateBaseline: BASELINE_ID,
      gateCandidate: CANDIDATE_ID,
      gateMinimumRatio: GATE_MIN_RATIO,
      wireBytesBasis: "payload-only",
    },
    configurations: results,
    gate: evaluateGate(results),
  };
};

export const writeReport = (report: BenchmarkReport, path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};
