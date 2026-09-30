import { describe, expect, it } from "vitest";
import weights from "../autobahn/shard-weights.json" with { type: "json" };
import { maxShardsFor, planShards } from "../autobahn/shard-plan.ts";
import { COMPRESSION_CASES, MODE_COUNTS, TOTAL_CASES } from "../autobahn/expected-cases.ts";

/// The committed weight table is hand-maintained, so these are the checks that stop
/// it rotting: the counts are pinned to the run that measured them and their sums
/// must equal the totals the repository asserts independently.

const TABLE = weights as {
  readonly groups: Readonly<Record<string, number>>;
  readonly caseCounts: Readonly<Record<string, number>>;
};

describe("weight table", () => {
  it("carries the per-group case counts measured by run 36287763043", () => {
    expect(TABLE.caseCounts).toEqual({
      "1": 16,
      "2": 11,
      "3": 7,
      "4": 10,
      "5": 20,
      "6": 145,
      "7": 37,
      "9": 54,
      "10": 1,
      "12": 90,
      "13": 126,
    });
  });

  it("agrees with the two totals the repository asserts independently", () => {
    // The counts are a measurement, so a sum alone is weak: the deflate groups are
    // checked against COMPRESSION_CASES and the rest against TOTAL_CASES.
    expect(TABLE.caseCounts["12"] + TABLE.caseCounts["13"]).toBe(COMPRESSION_CASES);
    expect(Object.values(TABLE.caseCounts).reduce((total, count) => total + count, 0)).toBe(
      TOTAL_CASES,
    );
  });

  it("prices every group it counts", () => {
    for (const group of Object.keys(TABLE.caseCounts)) {
      expect(TABLE.groups[group]).toBeGreaterThan(0);
    }
  });

  it("covers every group a mode can select, and prices every one", () => {
    for (const mode of ["framing", "full"] as const) {
      const plan = planShards(4, mode);
      const covered = plan.flatMap((shard) => [...shard.groups]).sort();
      expect(covered).toEqual([...MODE_COUNTS[mode].groups].sort());
      for (const shard of plan) expect(shard.costSeconds).toBeGreaterThan(0);
    }
  });
});

describe("the shard ceiling", () => {
  it("is the number of groups the selection has", () => {
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
