import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../autobahn/run-options.ts";
import { planShards } from "../autobahn/shard-plan.ts";

describe("run options", () => {
  it("defaults to the framing selection and one shard", () => {
    const options = parseOptions([]);
    expect(options.mode).toBe("framing");
    expect(options.shards).toBe(1);
    expect(options.force).toBe(false);
    expect(options.help).toBe(false);
    expect(options.fromReport).toBeUndefined();
  });

  it("selects the full 517 with --full", () => {
    expect(parseOptions(["--full"]).mode).toBe("full");
  });

  it("reads a shard count from the flag", () => {
    expect(parseOptions(["--shards", "4"]).shards).toBe(4);
    expect(parseOptions(["--full", "--shards", "8"]).shards).toBe(8);
  });

  it("reads a report path from --from-report", () => {
    // The mode still has to parse, because the gate is capacity-scoped by selection:
    // gating a framing report as if it were the full one would report the two deflate
    // groups as missing cases rather than as not selected.
    expect(parseOptions(["--from-report", "/tmp/index.json"]).fromReport).toBe("/tmp/index.json");
    expect(parseOptions(["--full", "--from-report", "/tmp/index.json"]).mode).toBe("full");
  });

  it("rejects --from-report with no path", () => {
    // A typo that silently became "run the suite" would be a 35-minute run on a
    // machine that was asked for a gate, and would also overwrite the recorded
    // summary with a fresh, empty one.
    expect(() => parseOptions(["--from-report"])).toThrow(RangeError);
    expect(() => parseOptions(["--from-report", "--full"])).toThrow(RangeError);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseOptions(["--nope"])).toThrow(RangeError);
  });

  it("rejects a missing or non-numeric shard count", () => {
    expect(() => parseOptions(["--shards"])).toThrow(RangeError);
    expect(() => parseOptions(["--shards", "0"])).toThrow(RangeError);
    expect(() => parseOptions(["--shards", "two"])).toThrow(RangeError);
  });

  it("keeps --help a no-op that still reports the usage", () => {
    const options = parseOptions(["--help"]);
    expect(options.help).toBe(true);
    expect(options.mode).toBe("framing");
  });
});

describe("the shard count from the environment", () => {
  const key = "AUTOBAHN_SHARDS";
  const saved = process.env[key];

  afterEach(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  });

  it("defaults to one so a local run stays unsplit", () => {
    delete process.env[key];
    expect(parseOptions([]).shards).toBe(1);
  });

  it("reads the count the workflow sets", () => {
    process.env[key] = "4";
    expect(parseOptions([]).shards).toBe(4);
  });

  it("is overridden by the flag", () => {
    process.env[key] = "4";
    expect(parseOptions(["--shards", "2"]).shards).toBe(2);
  });

  it("applies the mode's ceiling to the environment too", () => {
    // `framing` has ten groups, so eleven shards would leave one empty.
    process.env[key] = "11";
    expect(() => parseOptions([])).toThrow(RangeError);
    expect(() => parseOptions(["--full"])).not.toThrow();
  });

  it("rejects a non-numeric value rather than falling back", () => {
    process.env[key] = "four";
    expect(() => parseOptions([])).toThrow(RangeError);
  });
});

describe("the plan a CI run would use", () => {
  it("consistently produces four shards", () => {
    expect(planShards(4, "framing")).toHaveLength(4);
    expect(planShards(4, "full")).toHaveLength(4);
  });
});
