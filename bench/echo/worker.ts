import type { EchoConfig, EchoSample } from "./echo-types.ts";
import { resolveImplementation } from "./implementation.ts";
import { runEcho, unavailable } from "./echo-run.ts";

// The parent owns the environment channel, so the spec travels through the
// environment rather than a first IPC message: the worker then starts measuring
// as soon as its module graph is loaded.
export const SPEC_ENV = "VENTIJS_BENCH_SPEC";

export type SampleMessage = {
  readonly kind: "sample";
  readonly sample: EchoSample;
};

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`bench spec field "${key}" is missing`);
  return value;
};

const readCount = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`bench spec field "${key}" is not a positive integer`);
  }
  return value;
};

// The spec arrives over the environment, which is a trust boundary like any
// other input: it is decoded and narrowed before it reaches the measurement.
const decodeConfig = (raw: string): EchoConfig => {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("bench spec is not an object");
  const record = parsed as Record<string, unknown>;
  const id = readString(record, "implementation");
  if (id !== "ventijs" && id !== "ws") throw new Error(`unknown implementation "${id}"`);
  return {
    implementation: id,
    payloadBytes: readCount(record, "payloadBytes"),
    messages: readCount(record, "messages"),
    timeoutMs: readCount(record, "timeoutMs"),
  };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Every sample runs in a fresh isolate, so the worker force-exits: a socket
// aborted mid-sample keeps a handle open, and a hung child would stall the run.
// A spec the harness itself cannot decode is fatal here, and the parent turns
// the missing message into an unavailable sample.
export const runWorker = async (): Promise<void> => {
  const raw = process.env[SPEC_ENV];
  if (raw === undefined) {
    process.stderr.write("bench worker started without a spec\n");
    process.exit(1);
    return;
  }
  let config: EchoConfig;
  try {
    config = decodeConfig(raw);
  } catch (error) {
    process.stderr.write(`bench worker rejected the spec: ${describeError(error)}\n`);
    process.exit(1);
    return;
  }
  let sample: EchoSample;
  try {
    const implementation = await resolveImplementation(config.implementation);
    sample = await runEcho(implementation, config);
  } catch (error) {
    process.stderr.write(`bench worker failed: ${describeError(error)}\n`);
    sample = unavailable(config, describeError(error));
  }
  const message: SampleMessage = { kind: "sample", sample };
  process.send?.(message);
  process.exit(0);
};
