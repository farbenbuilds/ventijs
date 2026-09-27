import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_COUNT,
  SHARD_PORT_BASE,
  maxShardsFor,
  planShards,
  resolveShardCount,
} from "../autobahn/shard-plan.ts";
import { shardContainerName, shardSpec } from "../autobahn/shard-spec.ts";
import { MODE_COUNTS } from "../autobahn/suite-mode.ts";
import { HOST_GATEWAY } from "../autobahn/docker-args.ts";

function selected(plan: ReturnType<typeof planShards>): readonly string[] {
  return plan.flatMap((shard) => [...shard.groups]).sort();
}

describe("shard plan", () => {
  it("covers every group of the mode exactly once", () => {
    for (const mode of ["framing", "full"] as const) {
      for (const count of [1, 2, 3, 4, 5, 8]) {
        const plan = planShards(count, mode);
        expect(selected(plan)).toEqual([...MODE_COUNTS[mode].groups].sort());
      }
    }
  });

  it("gives every shard a distinct port above the fuzzing client default", () => {
    const plan = planShards(4, "full");
    const ports = plan.map((shard) => shard.port);
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) expect(port).toBeGreaterThan(9001);
    expect(ports[0]).toBe(SHARD_PORT_BASE);
  });

  it("only ever selects whole groups, so the union cannot miss a case", () => {
    const plan = planShards(4, "full");
    for (const shard of plan) {
      for (const pattern of shard.cases) expect(pattern).toMatch(/^\d+\.\*$/);
    }
  });

  it("leaves the critical path below the unsplit run", () => {
    const unsplit = planShards(1, "full")[0];
    const critical = Math.max(...planShards(4, "full").map((shard) => shard.costSeconds));
    expect(critical).toBeLessThan(unsplit.costSeconds);
  });

  /// The ceiling, stated so a future re-tune knows what it is up against.
  ///
  /// Group 6 is 145 of the 301 framing cases, so at any shard count up to ten it
  /// lands whole on one shard and the critical path cannot go below 48 per cent
  /// of the selection. Four shards therefore buy about 2x, not 4x, on framing,
  /// and no weight table can do better without splitting a group into sub-groups.
  /// The `cases` patterns are whole groups precisely so that coverage stays
  /// provable, so beating this needs the suite's per-sub-group case counts.
  it("cannot beat the heaviest group, which is nearly half the selection", () => {
    const plan = planShards(4, "framing");
    const heaviest = Math.max(...plan.map((shard) => shard.costSeconds));
    const total = plan.reduce((sum, shard) => sum + shard.costSeconds, 0);
    expect(heaviest / total).toBeGreaterThan(0.4);
    // And the ceiling is the same group whatever the shard count.
    for (const count of [2, 3, 4, 5, 8]) {
      const widest = Math.max(...planShards(count, "framing").map((s) => s.costSeconds));
      const whole = planShards(1, "framing")[0].costSeconds;
      expect(widest).toBeGreaterThanOrEqual(whole * 0.45);
    }
  });

  it("rejects a shard count that is not a positive integer", () => {
    expect(() => planShards(0, "full")).toThrow(RangeError);
    expect(() => planShards(2.5, "full")).toThrow(RangeError);
    expect(() => planShards(-1, "full")).toThrow(RangeError);
  });

  it("rejects more shards than the mode has groups", () => {
    // A shard that owns no group runs no cases, so the union is short of the
    // mode's total and the run fails on the count check rather than on the plan.
    // A validator that accepted this would approve a configuration that cannot
    // pass, and the failure would land after the build.
    const framing = MODE_COUNTS.framing.groups.length;
    const full = MODE_COUNTS.full.groups.length;
    expect(() => planShards(framing + 1, "framing")).toThrow(RangeError);
    expect(() => planShards(full + 1, "full")).toThrow(RangeError);
    expect(() => planShards(framing, "framing")).not.toThrow();
    expect(() => planShards(full, "full")).not.toThrow();
  });

  it("is a pure function of the count and the mode", () => {
    expect(planShards(4, "full")).toEqual(planShards(4, "full"));
  });
});

describe("shard spec", () => {
  it("points each shard's server at its own target port", () => {
    for (const shard of planShards(4, "full")) {
      const spec = shardSpec(shard);
      expect(spec.servers).toHaveLength(1);
      expect(spec.servers[0].url).toBe(`ws://${HOST_GATEWAY}:${shard.port}`);
      expect(spec.servers[0].agent).toBe("ventijs");
    }
  });

  it("keeps the report inside the container mount point", () => {
    const spec = shardSpec(planShards(2, "framing")[0]);
    expect(spec.outdir.startsWith("/reports")).toBe(true);
  });

  it("selects no cases and excludes none, matching the unsplit contract", () => {
    const spec = shardSpec(planShards(4, "full")[0]);
    expect(spec["exclude-cases"]).toEqual([]);
    expect(spec["exclude-agent-cases"]).toEqual({});
  });

  it("gives every shard a distinct container name", () => {
    const names = planShards(4, "full").map((shard) => shardContainerName(shard.id));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the CI default", () => {
  it("plans one shard per runner core", () => {
    expect(planShards(DEFAULT_SHARD_COUNT, "full")).toHaveLength(DEFAULT_SHARD_COUNT);
  });

  it("is inside the ceiling of both selections", () => {
    for (const mode of ["framing", "full"] as const) {
      expect(DEFAULT_SHARD_COUNT).toBeLessThanOrEqual(maxShardsFor(mode));
    }
  });
});

describe("the shared shard-count resolver", () => {
  it("accepts a positive integer as a string or a number", () => {
    expect(resolveShardCount("4", "full")).toBe(4);
    expect(resolveShardCount(1, "framing")).toBe(1);
  });

  it("applies the same ceiling the plan does", () => {
    expect(() => resolveShardCount(String(maxShardsFor("framing") + 1), "framing")).toThrow(
      RangeError,
    );
  });

  it("rejects the empty and non-numeric strings the environment can hold", () => {
    expect(() => resolveShardCount("", "full")).toThrow(RangeError);
    expect(() => resolveShardCount("many", "full")).toThrow(RangeError);
  });
});
