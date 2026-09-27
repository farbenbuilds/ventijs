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

  it("balances cost so no shard is more than half again the ideal share", () => {
    const count = 4;
    const plan = planShards(count, "full");
    const ideal = plan.reduce((total, shard) => total + shard.costSeconds, 0) / count;
    for (const shard of plan) expect(shard.costSeconds).toBeLessThanOrEqual(ideal * 1.5);
  });

  it("leaves the critical path below the unsplit run", () => {
    const unsplit = planShards(1, "full")[0];
    const critical = Math.max(...planShards(4, "full").map((shard) => shard.costSeconds));
    expect(critical).toBeLessThan(unsplit.costSeconds);
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
