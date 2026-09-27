import cluster from "node:cluster";
import type { EchoConfig, EchoSample, ImplementationId } from "../echo/echo-types.ts";
import { SPEC_ENV, type SampleMessage } from "../echo/worker.ts";
import type { BenchOptions } from "./options.ts";
import {
  PREFLIGHT_MESSAGES,
  PREFLIGHT_PAYLOAD_BYTES,
  PREFLIGHT_TIMEOUT_MS,
  SAMPLE_TIMEOUT_MS,
} from "./options.ts";
import type { SampleJob } from "./plan.ts";
import { IMPLEMENTATIONS } from "./plan.ts";

export type CollectOptions = {
  readonly bench: BenchOptions;
  readonly log: (line: string) => void;
};

// A worker that dies before it can time itself out would otherwise stall the
// run, so the parent bounds the child as well.
const GRACE_MS = 15000;
const parentDeadlineMs = (timeoutMs: number): number => timeoutMs + GRACE_MS;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isSampleMessage = (message: unknown): message is SampleMessage => {
  if (typeof message !== "object" || message === null) return false;
  const record = message as Record<string, unknown>;
  return record.kind === "sample" && typeof record.sample === "object" && record.sample !== null;
};

const failed = (job: SampleJob, reason: string): EchoSample => ({
  configuration: job.configuration,
  implementation: job.implementation,
  payloadBytes: job.payloadBytes,
  messages: job.messages,
  status: "unavailable",
  seconds: null,
  roundTripsPerSecond: null,
  wireBytesPerSecond: null,
  reason,
});

const configOf = (job: SampleJob, timeoutMs: number): EchoConfig => ({
  implementation: job.implementation,
  payloadBytes: job.payloadBytes,
  messages: job.messages,
  timeoutMs,
});

/// One sample per worker. A fresh isolate per sample keeps a leg from
/// inheriting the previous leg's JIT state, and a worker that dies takes down
/// one sample instead of the run.
const runJob = (job: SampleJob, timeoutMs: number): Promise<EchoSample> =>
  new Promise<EchoSample>((resolve) => {
    const worker = cluster.fork({ [SPEC_ENV]: JSON.stringify(configOf(job, timeoutMs)) });
    let settled = false;
    const finish = (sample: EchoSample): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      worker.removeAllListeners();
      worker.kill();
      resolve(sample);
    };
    const deadline = setTimeout(
      () =>
        finish(failed(job, `worker reported no sample within ${parentDeadlineMs(timeoutMs)} ms`)),
      parentDeadlineMs(timeoutMs),
    );
    worker.on("message", (message: unknown) => {
      finish(
        isSampleMessage(message)
          ? message.sample
          : failed(job, "worker sent an undecodable message"),
      );
    });
    worker.on("error", (error: Error) => finish(failed(job, describeError(error))));
    worker.on("exit", (code: number) =>
      finish(failed(job, `worker exited with code ${code} before reporting`)),
    );
  });

const probeOf = (job: SampleJob): SampleJob => ({
  ...job,
  configuration: `preflight:${job.implementation}`,
  payloadBytes: PREFLIGHT_PAYLOAD_BYTES,
  messages: PREFLIGHT_MESSAGES,
  repeat: 1,
});

/// One round trip per implementation decides whether a leg can answer at all.
/// It costs one worker each and saves one worker per configuration when the
/// answer is no, which is the difference between a run that reports and a run
/// that waits out a timeout on every row.
const probeImplementations = async (
  jobs: readonly SampleJob[],
  log: (line: string) => void,
): Promise<ReadonlyMap<ImplementationId, string>> => {
  const blocked = new Map<ImplementationId, string>();
  for (const id of IMPLEMENTATIONS) {
    const first = jobs.find((job) => job.implementation === id);
    if (first === undefined) continue;
    const sample = await runJob(probeOf(first), PREFLIGHT_TIMEOUT_MS);
    const reason = sample.status === "measured" ? null : sample.reason;
    log(reason === null ? `  preflight ${id}: echo round trip ok` : `  preflight ${id}: ${reason}`);
    if (reason !== null) blocked.set(id, `preflight: ${reason}`);
  }
  return blocked;
};

export const collectSamples = async (
  jobs: readonly SampleJob[],
  options: CollectOptions,
): Promise<readonly EchoSample[]> => {
  const blocked = await probeImplementations(jobs, options.log);
  const samples: EchoSample[] = [];
  for (const job of jobs) {
    const blockReason = blocked.get(job.implementation) ?? null;
    if (blockReason !== null) {
      samples.push(failed(job, blockReason));
      continue;
    }
    if (job.repeat <= options.bench.warmups) {
      options.log(`  warm-up ${job.repeat} (discarded)  ${job.configuration}`);
      continue;
    }
    options.log(
      `  repeat ${job.repeat}  ${job.configuration}  ${job.payloadBytes} B x ${job.messages}`,
    );
    samples.push(await runJob(job, SAMPLE_TIMEOUT_MS));
  }
  return samples;
};
