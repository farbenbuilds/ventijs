import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AGENT, CONTAINER_REPORTS_DIR } from "./paths.ts";
import { HOST_GATEWAY } from "./docker-args.ts";
import type { Shard } from "./shard-plan.ts";

/// The `fuzzingclient.json` document `wstest -m fuzzingclient -s` reads.
///
/// `cases` is the only case-selection mechanism the pinned `wstest` exposes -- it has no
/// `--cases` flag, and the suite runs one server at a time -- so a shard is its own spec file,
/// generated rather than committed because the union of their counts is what the gate checks.
export type ShardSpec = {
  readonly outdir: string;
  readonly servers: readonly { readonly agent: string; readonly url: string }[];
  readonly cases: readonly string[];
  readonly "exclude-cases": readonly string[];
  readonly "exclude-agent-cases": Readonly<Record<string, readonly string[]>>;
};

export function shardSpec(shard: Shard): ShardSpec {
  return {
    // `outdir` is resolved by `wstest` inside the container, so it stays the
    // mount point. Shard isolation comes from the host bind, not from here.
    outdir: `${CONTAINER_REPORTS_DIR}/servers`,
    servers: [{ agent: AGENT, url: `ws://${HOST_GATEWAY}:${shard.port}` }],
    cases: shard.cases,
    "exclude-cases": [],
    "exclude-agent-cases": {},
  };
}

export function writeShardSpec(path: string, spec: ShardSpec): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
}

/// A container name, so a run that is cancelled can remove exactly the container
/// it started rather than searching for one by label.
export function shardContainerName(id: number): string {
  return `ventijs-autobahn-${id}`;
}
