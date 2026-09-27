import { DEFAULT_SHARD_COUNT } from "./shard-plan.ts";
import type { SuiteMode } from "./suite-mode.ts";

/// How much of the suite a run selects, how it is split, and whether a
/// target that cannot echo is still measured.
export type RunOptions = {
  readonly help: boolean;
  readonly force: boolean;
  readonly mode: SuiteMode;
  readonly shards: number;
};

export const USAGE = [
  "usage: node tests/autobahn/run.ts [--full] [--force] [--shards N]",
  "",
  "Starts tests/autobahn/target.ts, measures whether it can echo, and runs the",
  "digest-pinned Autobahn fuzzing client against it. The report and a",
  "machine-readable summary are written on every exit path.",
  "",
  "  --full      select all 517 cases, including the per-message-deflate groups.",
  "              The default, framing, omits those two groups, which are 216 of",
  "              the 517 and every one is UNIMPLEMENTED because deflate is never",
  "              negotiated. The two selections cost almost the same: measured",
  "              2086s against 2100s, because a deflate case whose extension is",
  "              refused at the handshake returns immediately while the framing",
  "              and UTF-8 groups are where the client actually waits.",
  "  --shards N  run the selection as N concurrent fuzzing clients against N",
  "              targets on N ports. 1 is the unsplit run, which is what this",
  `              defaults to. AUTOBAHN_SHARDS, or ${DEFAULT_SHARD_COUNT}, applies`,
  "              when the flag is absent.",
  "  --force     run the fuzzing client even when the probe shows the target",
  "              cannot echo, so a failing run still captures suite evidence",
].join("\n");

function shardCount(raw: string | undefined, present: boolean): number {
  // A present flag with no value is an error, not a default: silently falling
  // back to one shard would turn a typo into a 35-minute run.
  if (raw === undefined || raw === "") {
    if (present) throw new RangeError("--shards expects a positive integer, got no value");
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`shard count must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/// Parses argv, and reads `AUTOBAHN_SHARDS` when the flag is absent.
///
/// A `--shards` flag takes precedence so a single run can be re-planned locally
/// without changing the environment the workflow sets.
export function parseOptions(argv: readonly string[]): RunOptions {
  const flags = new Set(argv);
  for (const arg of argv) {
    if (arg === "--shards" || isShardCount(argv, arg)) continue;
    if (!FLAGS.has(arg)) throw new RangeError(`unknown argument ${arg}; run with --help`);
  }
  const index = argv.indexOf("--shards");
  const raw = index === -1 ? process.env["AUTOBAHN_SHARDS"] : argv[index + 1];
  return {
    help: flags.has("--help"),
    force: flags.has("--force"),
    mode: flags.has("--full") ? "full" : "framing",
    shards: shardCount(raw, index !== -1),
  };
}

const FLAGS: ReadonlySet<string> = new Set(["--force", "--help", "--full", "--shards"]);

/// True for the value that follows `--shards`, so a bare number in argv is not
/// rejected as an unknown flag.
function isShardCount(argv: readonly string[], arg: string): boolean {
  const index = argv.indexOf("--shards");
  return index !== -1 && index + 1 < argv.length && argv[index + 1] === arg;
}
