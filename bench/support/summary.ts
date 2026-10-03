import type { EchoSample, ImplementationId } from "../echo/echo-types.ts";
import type { BenchOptions } from "./options.ts";
import { median, spread } from "./stats.ts";

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
  readonly legs: Readonly<Record<ImplementationId, Leg>>;
};

type Shape = {
  readonly messages: number;
  readonly payloadBytes: number;
};

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

/// Every implementation id gets a leg, whether or not this run selected it, so
/// a consumer can index `legs[id]` without a conditional and a deselected leg
/// is visibly absent rather than silently missing.
const blankLegs = (reason: string): Record<ImplementationId, Leg> => ({
  ws: emptyLeg(reason),
  ventiws: emptyLeg(reason),
  "uWebSockets.js": emptyLeg(reason),
  "socket.io": emptyLeg(reason),
});

/// One row per payload size, holding every selected leg. A row is the unit a
/// reader compares, so a size where a leg produced nothing stays a row with a
/// gap rather than disappearing from the table.
export const summarize = (
  options: BenchOptions,
  samples: readonly EchoSample[],
): readonly ConfigurationResult[] =>
  options.payloadSizes.map((payloadBytes) => {
    const shape: Shape = { messages: options.messages, payloadBytes };
    const gathered = samples.filter((sample) => sample.payloadBytes === payloadBytes);
    const legs = blankLegs("not selected in this run");
    for (const implementation of options.implementations) {
      legs[implementation] = legOf(shape, implementation, gathered);
    }
    return {
      configuration: `${payloadBytes}B`,
      payloadBytes,
      messages: options.messages,
      legs,
    };
  });
