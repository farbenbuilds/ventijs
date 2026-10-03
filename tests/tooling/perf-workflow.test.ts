// The publish job is the only place a workflow in this repository writes to a
// branch, so the trust split is asserted rather than assumed: pull requests run
// the compare job with a read-only token, and only a trusted main revision
// reaches the job that pushes benchmark-data as the GitHub Actions bot.

import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const ROOT = new URL("../../", import.meta.url);
const WORKFLOW = readFileSync(new URL(".github/workflows/perf.yml", ROOT), "utf8");
const PUBLISH_JOB = WORKFLOW.split(/\n {2}(?=publish-history:)/)[1] ?? "";
const COMPARE_JOB =
  WORKFLOW.split(/\n {2}(?=echo-throughput:)/)[1]?.split(/\n {2}(?=publish-history:)/)[0] ?? "";

test("the workflow's default token is read-only", () => {
  expect(WORKFLOW).toMatch(/permissions:\n {2}contents: read/);
});

test("only the publish job receives write permission", () => {
  expect(PUBLISH_JOB).toMatch(/permissions:\n {6}contents: write/);
  expect(COMPARE_JOB).not.toContain("contents: write");
});

test("a pull request can never publish history", () => {
  expect(PUBLISH_JOB).toContain("github.event_name != 'pull_request'");
  expect(PUBLISH_JOB).toContain("refs/heads/main");
});

test("the history push is made as the GitHub Actions bot", () => {
  expect(PUBLISH_JOB).toContain("github-actions[bot]");
  expect(PUBLISH_JOB).toContain("41898282+github-actions[bot]@users.noreply.github.com");
  expect(PUBLISH_JOB).toContain("git -C history push origin HEAD:benchmark-data");
});

test("the publisher reads the contract files this repository owns", () => {
  for (const path of [
    "bench/contracts/echo_throughput_v1.env",
    "bench/contracts/echo_throughput_v1.schema.json",
    "bench/contracts/CONTRACT.md",
    "scripts/publish-bench-history.mjs",
  ]) {
    expect(existsSync(new URL(path, ROOT))).toBe(true);
    expect(WORKFLOW).toContain(path);
  }
});

test("the uploaded artifact is the one the publisher downloads", () => {
  expect(WORKFLOW).toContain("name: echo-throughput");
});

test("the history runs nightly and the measured step never gates", () => {
  expect(WORKFLOW).toContain("schedule:");
  expect(WORKFLOW).toContain("cron:");
  expect(WORKFLOW).toContain("run: pnpm run bench");
  expect(WORKFLOW).not.toMatch(/pnpm run bench --gate/);
});
