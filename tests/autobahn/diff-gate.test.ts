import { describe, expect, it } from "vitest";
import { ENGINE_PATHS, decideRun, isEnginePath } from "../autobahn/diff-gate-cli.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = readFileSync(
  join(import.meta.dirname, "..", "..", ".github", "workflows", "autobahn.yml"),
  "utf8",
);

describe("engine path matching", () => {
  it("treats every Zig source as engine-relevant, at any depth", () => {
    expect(isEnginePath("src/engine/server/connections.zig")).toBe(true);
    expect(isEnginePath("build.zig")).toBe(true);
    expect(isEnginePath("zig-pkg/uWebZockets-1.7.0/src/ws/socket.zig")).toBe(true);
  });

  it("treats the harness and its toolchain as engine-relevant", () => {
    expect(isEnginePath("tests/autobahn/shard-plan.ts")).toBe(true);
    expect(isEnginePath(".github/workflows/autobahn.yml")).toBe(true);
    expect(isEnginePath("build.zig.zon")).toBe(true);
    expect(isEnginePath("pnpm-lock.yaml")).toBe(true);
  });

  it("leaves the facade, the docs, and the rest of CI alone", () => {
    expect(isEnginePath("src/compat/socket/send.ts")).toBe(false);
    expect(isEnginePath("README.md")).toBe(false);
    expect(isEnginePath("docs/compliance.md")).toBe(false);
    expect(isEnginePath(".github/workflows/ts-test.yml")).toBe(false);
    expect(isEnginePath("tests/compat/socket/socket.test.ts")).toBe(false);
  });
});

describe("the skip decision", () => {
  it("runs when the engine moved", () => {
    const decision = decideRun({
      watermark: "a10fef7",
      changedPaths: ["README.md", "src/engine/socket/payload.zig"],
      alwaysRun: false,
    });
    expect(decision.run).toBe(true);
    expect(decision.changed).toEqual(["src/engine/socket/payload.zig"]);
  });

  it("skips a facade-only or docs-only push on an engine branch", () => {
    // The case the workflow's own `paths` filter cannot catch, because GitHub
    // evaluates it against the whole pull request diff.
    const decision = decideRun({
      watermark: "a10fef7",
      changedPaths: ["src/compat/socket/send.ts", "COMPATIBILITY.md", "docs/compliance-api.md"],
      alwaysRun: false,
    });
    expect(decision.run).toBe(false);
    expect(decision.changed).toHaveLength(3);
  });

  it("runs on the first push to a branch, which has no watermark", () => {
    expect(decideRun({ watermark: null, changedPaths: [], alwaysRun: false }).run).toBe(true);
    expect(decideRun({ watermark: "", changedPaths: [], alwaysRun: false }).run).toBe(true);
  });

  it("always runs the scheduled and the manual backstop", () => {
    expect(decideRun({ watermark: "a10fef7", changedPaths: [], alwaysRun: true }).run).toBe(true);
  });

  it("names the commit it compared against when it skips", () => {
    const decision = decideRun({
      watermark: "deadbee",
      changedPaths: ["README.md"],
      alwaysRun: false,
    });
    expect(decision.reason).toContain("deadbee");
  });
});

describe("the decision and the workflow filter", () => {
  it("treats every path the workflow filter lists as engine-relevant", () => {
    // If the YAML grows a path the gate does not know about, the gate would skip
    // a push the filter runs, which is a silent coverage hole. This is the test
    // that makes the two definitions agree.
    const filter = /paths:\n((?:\s+- .*\n)+)/g;
    const listed: string[] = [];
    for (const block of WORKFLOW.matchAll(filter)) {
      for (const line of block[1].split("\n")) {
        const quoted = line.trim().match(/^-\s+"?([^"]+)"?$/);
        if (quoted !== null) listed.push(quoted[1]);
      }
    }
    expect(listed.length).toBeGreaterThan(0);
    // No exemption list. `src/**` used to be skipped here, which is exactly the
    // entry this test exists to catch, so a workflow that re-added it would have
    // been silently approved.
    expect(listed).not.toContain("src/**");
    for (const path of listed) expect(ENGINE_PATHS).toContain(path);
  });
});
