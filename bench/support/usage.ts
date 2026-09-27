import {
  DEFAULT_MESSAGES,
  DEFAULT_PAYLOAD_SIZES,
  DEFAULT_REPEATS,
  DEFAULT_REPORT_PATH,
  DEFAULT_WARMUPS,
  GATE_MIN_RATIO,
  VENTIJS_MAX_MESSAGE_BYTES,
} from "./options.ts";

/// Help text is its own module because it is the only prose surface in the
/// harness, and prose is what grows when a limit or a flag changes.
export const USAGE = `ventijs echo benchmark

Usage: node bench/index.ts [options]

Options:
  --sizes=<bytes,...>     payload matrix, each at most ${VENTIJS_MAX_MESSAGE_BYTES} (default: ${DEFAULT_PAYLOAD_SIZES.join(",")})
  --messages=<count>      round trips per sample (default: ${DEFAULT_MESSAGES})
  --repeats=<count>       measured repeats per configuration, at least 2 (default: ${DEFAULT_REPEATS})
  --warmups=<count>       repeats discarded before measuring (default: ${DEFAULT_WARMUPS})
  --report=<path>         write the JSON report here (default: ${DEFAULT_REPORT_PATH})
  --gate                  exit non-zero when ventijs is below ${GATE_MIN_RATIO} of the ws median
  --help                  print this text

ventijs is capped at ${VENTIJS_MAX_MESSAGE_BYTES} bytes per message by its pinned
engine, so sizes above that ceiling are rejected rather than compared. Raise
--warmups on a host whose first workers are slower than its later ones, and
trust the sample spread in the report over any default.
`;
