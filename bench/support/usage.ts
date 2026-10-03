import {
  ALL_IMPLEMENTATION_IDS,
  BASELINE_ID,
  CANDIDATE_ID,
  IMPLEMENTATION_LABELS,
} from "../echo/echo-types.ts";
import { ECHO_PAYLOAD_CEILING_BYTES } from "../echo/echo-limits.ts";
import {
  DEFAULT_MESSAGES,
  DEFAULT_PAYLOAD_SIZES,
  DEFAULT_REPEATS,
  DEFAULT_REPORT_PATH,
  DEFAULT_WARMUPS,
  GATE_MIN_RATIO,
} from "./options.ts";

const legLines = ALL_IMPLEMENTATION_IDS.map(
  (id) => `  ${id.padEnd(22)} ${IMPLEMENTATION_LABELS[id]}`,
).join("\n");

/// Help text is its own module because it is the only prose surface in the
/// harness, and prose is what grows when a limit or a flag changes.
export const USAGE = `ventiws echo benchmark

Usage: node bench/index.ts [options]

Options:
  --implementations=<list>  comma-separated legs (default: ${ALL_IMPLEMENTATION_IDS.join(",")})
  --sizes=<bytes,...>       payload matrix, each at most ${ECHO_PAYLOAD_CEILING_BYTES} (default: ${DEFAULT_PAYLOAD_SIZES.join(",")})
  --messages=<count>        round trips per sample (default: ${DEFAULT_MESSAGES})
  --repeats=<count>         measured repeats per configuration, at least 2 (default: ${DEFAULT_REPEATS})
  --warmups=<count>         full-workload repeats discarded before measuring (default: ${DEFAULT_WARMUPS})
  --report=<path>           write the JSON report here (default: ${DEFAULT_REPORT_PATH})
  --gate                    exit non-zero when ${CANDIDATE_ID} is below ${GATE_MIN_RATIO} of the ${BASELINE_ID} median
  --help                    print this text

Legs:
${legLines}

The gate reads only ${BASELINE_ID} and ${CANDIDATE_ID}; uWebSockets.js and socket.io are
reference rows and never decide the verdict. ventiws is capped at ${ECHO_PAYLOAD_CEILING_BYTES}
bytes per message by its pinned engine, so sizes above that ceiling are
rejected rather than compared. Raise --warmups on a host whose first workers
are slower than its later ones, and trust the sample spread in the report over
any default.
`;
