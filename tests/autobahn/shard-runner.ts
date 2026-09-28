import { mkdirSync } from "node:fs";
import { removeContainer } from "./container-cleanup.ts";
import { shardReportsDir, shardSpecPath } from "./paths.ts";
import { runContainer } from "./suite.ts";
import type { Shard } from "./shard-plan.ts";
import { shardContainerName, shardSpec, writeShardSpec } from "./shard-spec.ts";
import { readShardCases } from "./shard-reports.ts";
import type { ShardResult } from "./shard-reports.ts";

/// Writes each shard's `fuzzingclient.json` before anything is started.
///
/// The pinned `wstest` exposes no case-selection flag but `-s`, and the suite runs one server
/// at a time, so N concurrent shards need N spec files; generating them keeps the union
/// checkable by the gate instead of leaving N committed configurations to fall out of sync.
function prepare(shard: Shard): void {
  mkdirSync(shardReportsDir(shard.id), { recursive: true });
  writeShardSpec(shardSpecPath(shard.id), shardSpec(shard));
}

/// Runs every shard's fuzzing client concurrently and collects what each wrote.
///
/// All containers are force-removed before this returns, on every path, so a cancelled or
/// failed run cannot leave one holding a report directory. The streams are inherited rather
/// than prefixed, which is what sharding gives up: N Python tracebacks interleave in one log.
export async function runShards(shards: readonly Shard[]): Promise<readonly ShardResult[]> {
  for (const shard of shards) prepare(shard);
  // Settled, not raced: a shard whose report will not parse must not discard the other
  // shards' evidence, so a rejected read becomes a failed shard the failure message names.
  const settled = await Promise.allSettled(
    shards.map(async (shard) => {
      const name = shardContainerName(shard.id);
      try {
        const code = await runContainer({
          configHostPath: shardSpecPath(shard.id),
          reportsHostDir: shardReportsDir(shard.id),
          name,
        });
        return { shard, code, cases: readShardCases(shard.id) };
      } finally {
        removeContainer(name);
      }
    }),
  );
  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const shard = shards[index];
    process.stderr.write(
      `autobahn: shard ${shard.id} report unreadable: ${String(entry.reason)}\n`,
    );
    return { shard, code: 127, cases: [] };
  });
}
