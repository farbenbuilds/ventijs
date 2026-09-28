import { DEFAULT_SHARD_COUNT, resolveShardCount } from "./shard-plan.ts";
import type { SuiteMode } from "./suite-mode.ts";

/// How much of the suite a run selects, how it is split, and whether a
/// target that cannot echo is still measured.
export type RunOptions = {
  readonly help: boolean;
  readonly force: boolean;
  readonly mode: SuiteMode;
  readonly shards: number;
  /// An existing `servers/index.json` to gate instead of running the suite.
  ///
  /// Generation needs the digest-pinned fuzzing client, which is a frozen Python 2.7
  /// image and therefore a Docker-capable host. *Evaluation* needs nothing: the gate
  /// takes a case list and nothing else. Conflating the two made "I cannot re-record
  /// the baseline" structural when it is a matter of somebody pasting a JSON file.
  readonly fromReport: string | undefined;
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
  "              the 517. The two selections cost about the same: a per-case cost",
  "              that is a near-constant inside the client rather than anything",
  "              on this side.",
  "  --shards N  run the selection as N concurrent fuzzing clients against N",
  "              targets on N ports. At most one per group the selection has, and",
  "              the ceiling differs per selection.",
  `  --shards    absent means one, the unsplit run, so a local run is unchanged.`,
  `              CI sets AUTOBAHN_SHARDS=${DEFAULT_SHARD_COUNT} to shard, and the flag`,
  "              overrides the variable.",
  "  --force     run the fuzzing client even when the probe shows the target",
  "              cannot echo, so a failing run still captures suite evidence",
  "",
  "  --from-report PATH",
  "              gate an existing servers/index.json instead of running the suite.",
  "              Needs no container, no target, and no network: the gate is a pure",
  "              function of the report, so this is how a baseline is re-recorded and",
  "              how a gate change is tested locally. The report must come from the",
  "              digest-pinned client, since the case set is only meaningful against",
  "              that exact image.",
].join("\n");

function shardCount(raw: string | undefined, present: boolean, mode: SuiteMode): number {
  // A present flag with no value is an error, not a default: silently falling
  // back to one shard would turn a typo into a 35-minute run.
  if (raw === undefined || raw === "") {
    if (present) throw new RangeError("--shards expects a positive integer, got no value");
    return 1;
  }
  return resolveShardCount(raw, mode);
}

/// Parses argv, and reads `AUTOBAHN_SHARDS` when the flag is absent.
///
/// A `--shards` flag takes precedence so a single run can be re-planned locally
/// without changing the environment the workflow sets.
export function parseOptions(argv: readonly string[]): RunOptions {
  const flags = new Set(argv);
  const shardIndex = argv.indexOf("--shards");
  const reportIndex = argv.indexOf("--from-report");
  for (const arg of argv) {
    if (isFlagValue(argv, "--shards", shardIndex, arg)) continue;
    if (isFlagValue(argv, "--from-report", reportIndex, arg)) continue;
    if (!FLAGS.has(arg)) throw new RangeError(`unknown argument ${arg}; run with --help`);
  }
  const raw = shardIndex === -1 ? process.env["AUTOBAHN_SHARDS"] : argv[shardIndex + 1];
  const mode: SuiteMode = flags.has("--full") ? "full" : "framing";
  return {
    help: flags.has("--help"),
    force: flags.has("--force"),
    mode,
    shards: shardCount(raw, shardIndex !== -1, mode),
    fromReport: reportIndex === -1 ? undefined : requiredValue(argv, "--from-report", reportIndex),
  };
}

const FLAGS: ReadonlySet<string> = new Set([
  "--force",
  "--help",
  "--full",
  "--shards",
  "--from-report",
]);

/// True for the value that follows a flag, so a bare word in argv is not rejected as
/// an unknown flag.
function isFlagValue(argv: readonly string[], flag: string, index: number, arg: string): boolean {
  return index !== -1 && index + 1 < argv.length && argv[index + 1] === arg && argv[index] === flag;
}

/// A flag present with no value is an error rather than a default, for the same
/// reason `--shards` is: a typo that silently became the default would gate the
/// wrong report, or none.
function requiredValue(argv: readonly string[], flag: string, index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new RangeError(`${flag} expects a path, got no value`);
  }
  return value;
}
