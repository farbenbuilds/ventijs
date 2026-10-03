import type { ImplementationId } from "../echo/echo-types.ts";
import type { BenchOptions } from "./options.ts";

export type SampleJob = {
  readonly configuration: string;
  readonly implementation: ImplementationId;
  readonly payloadBytes: number;
  readonly messages: number;
  readonly repeat: number;
};

/// Warm-up repeats come first in the plan and carry the same shape as a
/// measured repeat, because a warm-up that does not run the real workload does
/// not warm anything. Repeats are the outer loop so host drift over the run
/// reaches every leg in the same proportions: running one leg to completion
/// first would hand the later legs a warmer, quieter machine.
export const buildPlan = (options: BenchOptions): readonly SampleJob[] => {
  const jobs: SampleJob[] = [];
  const total = options.warmups + options.repeats;
  for (let repeat = 1; repeat <= total; repeat += 1) {
    for (const payloadBytes of options.payloadSizes) {
      for (const implementation of options.implementations) {
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
