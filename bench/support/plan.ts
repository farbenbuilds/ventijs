import type { EchoSample, ImplementationId } from "../echo/echo-types.ts";
import type { BenchOptions } from "./options.ts";
import { GATE_MIN_RATIO } from "./options.ts";
import { median, spread } from "./stats.ts";

export type SampleJob = {
  readonly configuration: string;
  readonly implementation: ImplementationId;
  readonly payloadBytes: number;
  readonly messages: number;
  readonly repeat: number;
};

/// One implementation's result for one payload size. A null field means the leg
/// produced no number, never that the number was zero or rounded away.
export type Leg = {
  readonly samples: readonly number[];
  readonly medianSeconds: number | null;
  readonly medianRoundTripsPerSecond: number | null;
  readonly medianWireBytesPerSecond: number | null;
  readonly spread: number | null;
  readonly reason: string | null;
};

export type ConfigurationResult = {
  readonly configuration: string;
  readonly payloadBytes: number;
  readonly messages: number;
  readonly ws: Leg;
  readonly ventijs: Leg;
};

export type GateVerdict = {
  readonly failed: boolean;
  readonly lines: readonly string[];
};

type Shape = {
  readonly messages: number;
  readonly payloadBytes: number;
};

export const IMPLEMENTATIONS: readonly ImplementationId[] = ["ws", "ventijs"];

const emptyLeg = (reason: string): Leg => ({
  samples: [],
  medianSeconds: null,
  medianRoundTripsPerSecond: null,
  medianWireBytesPerSecond: null,
  spread: null,
  reason,
});

const legOf = (
  shape: Shape,
  implementation: ImplementationId,
  samples: readonly EchoSample[],
): Leg => {
  const gathered = samples.filter((sample) => sample.implementation === implementation);
  const reason = gathered.map((sample) => sample.reason).find((value) => value !== null) ?? null;
  const seconds = gathered.flatMap((sample) => (sample.seconds === null ? [] : [sample.seconds]));
  if (seconds.length === 0) return emptyLeg(reason ?? "no sample produced a timing");
  const center = median(seconds);
  // Reciprocating the median seconds gives the median of the per-sample rates,
  // because every sample sends the same payload the same number of times.
  return {
    samples: seconds,
    medianSeconds: center,
    // Rates are rounded because no reader needs fifteen significant digits of
    // them; the raw seconds above stay exact so every rate can be recomputed.
    medianRoundTripsPerSecond: Math.round(shape.messages / center),
    medianWireBytesPerSecond: Math.round((shape.payloadBytes * 2 * shape.messages) / center),
    spread: spread(seconds),
    reason: null,
  };
};

/// Warm-up repeats come first in the plan and carry the same shape as a
/// measured repeat, because a warm-up that does not run the real workload does
/// not warm anything. Repeats are the outer loop so host drift over the run
/// reaches both legs in the same proportions: running one leg to completion
/// first would hand the second leg a warmer, quieter machine.
export const buildPlan = (options: BenchOptions): readonly SampleJob[] => {
  const jobs: SampleJob[] = [];
  const total = options.warmups + options.repeats;
  for (let repeat = 1; repeat <= total; repeat += 1) {
    for (const payloadBytes of options.payloadSizes) {
      for (const implementation of IMPLEMENTATIONS) {
        jobs.push({
          configuration: `${implementation}@${payloadBytes}B`,
          implementation,
          payloadBytes,
          messages: options.messages,
          repeat,
        });
      }
    }
  }
  return jobs;
};

/// One row per payload size, holding both legs. A row is the unit a reader
/// compares, so a size where one leg produced nothing stays a row with a gap
/// rather than disappearing from the table.
export const summarize = (
  options: BenchOptions,
  samples: readonly EchoSample[],
): readonly ConfigurationResult[] =>
  options.payloadSizes.map((payloadBytes) => {
    const shape: Shape = { messages: options.messages, payloadBytes };
    const gathered = samples.filter((sample) => sample.payloadBytes === payloadBytes);
    return {
      configuration: `${payloadBytes}B`,
      payloadBytes,
      messages: options.messages,
      ws: legOf(shape, "ws", gathered),
      ventijs: legOf(shape, "ventijs", gathered),
    };
  });

const evaluate = (result: ConfigurationResult): string => {
  if (result.ws.medianRoundTripsPerSecond === null) {
    return `unverified  ${result.configuration}: no ws baseline (${result.ws.reason})`;
  }
  if (result.ventijs.medianRoundTripsPerSecond === null) {
    return `unverified  ${result.configuration}: no ventijs number (${result.ventijs.reason})`;
  }
  const ratio = result.ventijs.medianRoundTripsPerSecond / result.ws.medianRoundTripsPerSecond;
  if (ratio >= GATE_MIN_RATIO) {
    return `pass        ${result.configuration}: ${ratio.toFixed(3)} of ws`;
  }
  return `FAIL        ${result.configuration}: ${ratio.toFixed(3)} of ws is below ${GATE_MIN_RATIO}`;
};

/// A configuration the harness could not measure is not a pass. A gate that
/// only fires on a measured regression would report success on a run that
/// measured nothing at all.
export const evaluateGate = (results: readonly ConfigurationResult[]): GateVerdict => {
  const lines = results.map(evaluate);
  return { failed: lines.some((line) => !line.startsWith("pass")), lines };
};
