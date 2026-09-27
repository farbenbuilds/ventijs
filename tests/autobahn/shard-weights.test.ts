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

  it("prices the deflate groups as near-free, matching the measured run", () => {
    // 2086s for the 301 framing cases and 2100s for all 517 puts the 216 deflate
    // cases at about 14s between them, so they cannot carry a share of the split.
    const framing = planShards(1, "framing")[0];
    const full = planShards(1, "full")[0];
    expect(full.costSeconds - framing.costSeconds).toBeLessThan(framing.costSeconds * 0.05);
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
