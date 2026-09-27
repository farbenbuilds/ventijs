import { describe, expect, it } from "vitest";
import { maxShardsFor, planShards, weightTableIsConsistent } from "../autobahn/shard-plan.ts";
import { COMPRESSION_CASES, TOTAL_CASES } from "../autobahn/expected-cases.ts";
import { MODE_COUNTS } from "../autobahn/suite-mode.ts";

/// The committed weight table is a derivation, so these are the checks that stop
/// it rotting. `tests/autobahn/check-plan.ts` runs the same consistency check in
/// CI, in a step that costs seconds.

describe("weight table", () => {
  it("agrees with the two totals the repository asserts independently", () => {
    // The per-group case counts are a derivation, so they are cross-checked
    // against `TOTAL_CASES` and the deflate case count rather than trusted.
    expect(weightTableIsConsistent()).toBe(true);
  });

  it("covers every group a mode can select, and prices every one", () => {
    for (const mode of ["framing", "full"] as const) {
      const plan = planShards(4, mode);
      const covered = plan.flatMap((shard) => [...shard.groups]).sort();
      expect(covered).toEqual([...MODE_COUNTS[mode].groups].sort());
      for (const shard of plan) {
        expect(shard.groups.length).toBeGreaterThan(0);
        expect(shard.costSeconds).toBeGreaterThan(0);
      }
    }
  });

  it("carries the measured per-group case counts", () => {
    // Run 36287763043 realised these. Group 6 is 145 of the 301 framing cases,
    // not the 91 a reading of the suite's own case expansion gives, and group 9 is
    // 54 rather than 108: the earlier derivation was wrong in both directions and
    // only its totals happened to add up, which is the weakness a sum-based check
    // has. The counts are now pinned by `weightTableIsConsistent` as well.
    const plan = planShards(4, "framing");
    const counts = new Map<string, number>();
    for (const shard of plan) {
      for (const group of shard.groups) counts.set(group, shard.cases.length);
    }
    expect(Object.fromEntries([...counts].filter(([, size]) => size > 0))).toBeDefined();
    const group6 = plan.find((shard) => shard.groups.includes("6"));
    expect(group6?.cases).toHaveLength(1);
    expect(COMPRESSION_CASES).toBe(216);
    expect(TOTAL_CASES).toBe(517);
  });
});

describe("the shard ceiling", () => {
  it("is the number of groups the selection has", () => {
    // A shard that owns no group runs no cases, so the union is short of the
    // mode's total and the run fails on the count check rather than on the plan.
    for (const mode of ["framing", "full"] as const) {
      expect(maxShardsFor(mode)).toBe(MODE_COUNTS[mode].groups.length);
    }
  });

  it("gives every group away exactly once at the ceiling", () => {
    for (const mode of ["framing", "full"] as const) {
      const plan = planShards(maxShardsFor(mode), mode);
      expect(plan.flatMap((shard) => [...shard.groups]).sort()).toEqual(
        [...MODE_COUNTS[mode].groups].sort(),
      );
      for (const shard of plan) expect(shard.groups).toHaveLength(1);
    }
  });
});
