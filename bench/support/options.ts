/// The pinned engine compiles `message_capacity` to 32 KiB
/// (`src/engine/server/options.zig`), so a larger payload cannot be echoed by
/// ventijs at any speed. `ws` accepts hundreds of MiB, which means a size above
/// the ceiling is not a slower run, it is a run ventijs cannot finish. The
/// matrix stops at the ceiling so a row can never claim a win it did not earn.
export const VENTIJS_MAX_MESSAGE_BYTES = 32 * 1024;

export const DEFAULT_PAYLOAD_SIZES: readonly number[] = [
  64,
  1024,
  16 * 1024,
  VENTIJS_MAX_MESSAGE_BYTES,
];

// `CI_CD_PIPELINE.md` fixes the protocol: repeat three times, discard the
// warm-up, compare medians. The warm-up count is a flag rather than a constant
// because it is host-dependent, and a measured run is the only way to set it.
export const DEFAULT_REPEATS = 3;
export const DEFAULT_WARMUPS = 1;

// Sized from a measured spread curve on the smallest payload, where a short
// window is the only one that matters. At 20000 round trips a 64 B sample
// lasts 0.17 s, less than this host's clock ramp, and the samples spread by 29
// percent. At 200000 they spread by 1.8 percent, and the whole matrix runs in
// about 75 seconds. Raise this for a faster host, lower it for a slower one,
// and trust the reported spread over the flag.
export const DEFAULT_MESSAGES = 200000;
export const DEFAULT_REPORT_PATH = "bench/results/report.json";

export const SAMPLE_TIMEOUT_MS = 120000;

// A preflight is one round trip with a short deadline. It costs one fork per
// implementation and saves a fork per configuration when a leg cannot answer.
export const PREFLIGHT_TIMEOUT_MS = 5000;
export const PREFLIGHT_PAYLOAD_BYTES = 64;
export const PREFLIGHT_MESSAGES = 1;

// The gate fails below 90 percent of the baseline. Ten percent is wider than
// the run-to-run spread of a quiet shared runner and narrower than a throughput
// change a reader would notice, so it absorbs noise without hiding a
// regression. A configuration with no number cannot be shown to pass, so it
// counts as a failure rather than as a skip.
export const GATE_MIN_RATIO = 0.9;

export type BenchOptions = {
  readonly payloadSizes: readonly number[];
  readonly repeats: number;
  readonly warmups: number;
  readonly messages: number;
  readonly gate: boolean;
  readonly reportPath: string;
  readonly help: boolean;
};

const readCount = (
  flag: string,
  raw: string | undefined,
  fallback: number,
  minimum = 1,
): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${flag} expects an integer of at least ${minimum}, received "${raw}"`);
  }
  return value;
};

const readSizes = (
  flag: string,
  raw: string | undefined,
  fallback: readonly number[],
): readonly number[] => {
  if (raw === undefined) return fallback;
  const sizes = raw.split(",").map((field) => readCount(flag, field.trim(), 0));
  if (sizes.length === 0) throw new Error(`${flag} expects at least one payload size`);
  return sizes;
};

const assertWithinCeiling = (size: number): void => {
  if (size <= VENTIJS_MAX_MESSAGE_BYTES) return;
  throw new Error(
    `payload size ${size} exceeds the ventijs engine ceiling of ${VENTIJS_MAX_MESSAGE_BYTES} bytes ` +
      "(src/engine/server/options.zig); comparing above it would measure a capability ventijs lacks, not a speed",
  );
};

export const parseOptions = (argv: readonly string[]): BenchOptions => {
  let repeats = DEFAULT_REPEATS;
  let warmups = DEFAULT_WARMUPS;
  let messages = DEFAULT_MESSAGES;
  let payloadSizes = DEFAULT_PAYLOAD_SIZES;
  let reportPath = DEFAULT_REPORT_PATH;
  let gate = false;
  let help = false;
  for (const argument of argv) {
    if (!argument.startsWith("--")) throw new Error(`unexpected argument "${argument}"`);
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? undefined : argument.slice(separator + 1);
    switch (flag) {
      case "--repeats":
        repeats = readCount(flag, value, repeats);
        break;
      case "--warmups":
        warmups = readCount(flag, value, warmups, 0);
        break;
      case "--messages":
        messages = readCount(flag, value, messages);
        break;
      case "--sizes":
        payloadSizes = readSizes(flag, value, payloadSizes);
        break;
      case "--report":
        if (value === undefined || value === "") throw new Error(`${flag} expects a path`);
        reportPath = value;
        break;
      case "--gate":
        gate = true;
        break;
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`unknown flag "${flag}"`);
    }
  }
  if (repeats < 2) {
    throw new Error(`--repeats must be at least 2, because a median of one sample is not a median`);
  }
  for (const size of payloadSizes) assertWithinCeiling(size);
  return { payloadSizes, repeats, warmups, messages, gate, reportPath, help };
};
