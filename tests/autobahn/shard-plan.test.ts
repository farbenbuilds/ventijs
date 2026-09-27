import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_COUNT,
  SHARD_PORT_BASE,
  planShards,
  weightTableIsConsistent,
} from "../autobahn/shard-plan.ts";
import { shardContainerName, shardSpec } from "../autobahn/shard-spec.ts";
import { MODE_COUNTS } from "../autobahn/suite-mode.ts";
import { COMPRESSION_CASES, TOTAL_CASES } from "../autobahn/expected-cases.ts";
import { HOST_GATEWAY } from "../autobahn/docker-args.ts";

const ALL_GROUPS = MODE_COUNTS.full.groups;

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

  it("rejects a shard count outside the supported range", () => {
    expect(() => planShards(0, "full")).toThrow(RangeError);
    expect(() => planShards(17, "full")).toThrow(RangeError);
    expect(() => planShards(2.5, "full")).toThrow(RangeError);
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
});

describe("weight table", () => {
  it("agrees with the two totals the repository asserts independently", () => {
    // The per-group case counts are a derivation, so they are cross-checked
    // against `TOTAL_CASES` and the deflate case count rather than trusted.
    expect(weightTableIsConsistent()).toBe(true);
  });

  it("covers every group a mode can select, and prices every one", () => {
    const plan = planShards(4, "full");
    for (const shard of plan) {
      expect(shard.groups.length).toBeGreaterThan(0);
      expect(shard.costSeconds).toBeGreaterThan(0);
    }
    expect([...ALL_GROUPS].sort()).toEqual(selected(plan));
  });

  it("prices the deflate groups as near-free, matching the measured run", () => {
    // 2086s for 301 framing cases and 2100s for all 517 puts the 216 deflate
    // cases at about 14s together, so they cannot carry a share of the split.
    const framing = planShards(1, "framing")[0];
    const full = planShards(1, "full")[0];
    const deflate = full.costSeconds - framing.costSeconds;
    expect(deflate).toBeLessThan(framing.costSeconds * 0.05);
    expect(COMPRESSION_CASES).toBe(216);
    expect(TOTAL_CASES).toBe(517);
  });
});
