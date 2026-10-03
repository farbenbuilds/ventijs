// The publisher is the seam between a benchmark run and the durable
// benchmark-data branch: it refuses a report that drifted from the contract,
// writes an immutable record beside its raw evidence, and is idempotent for a
// re-run of the same record.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { publishRecord } from "../../scripts/bench-history.mjs";
import { build, publishInput, reportOf } from "./bench-fixtures";

const historyOf = (): string => mkdtempSync(join(tmpdir(), "ventiws-bench-history-"));

test("a contract-conforming report becomes a record with its provenance", () => {
  const record = build(reportOf());
  expect(record.record_id).toBe(`123-1-${"a".repeat(12)}`);
  expect(record.guarantee.passed).toBe(true);
  expect(record.results.configurations).toHaveLength(4);
  expect(record.results.configurations[0].candidate_to_baseline_ratio).toBeCloseTo(1, 5);
});

test("a report whose parameters drifted from the contract is refused", () => {
  expect(() => build(reportOf(200_001))).toThrow(/messages does not match the contract/);
});

test("publishing writes the record, its raw report, and the branch scaffolding", () => {
  const history = historyOf();
  const record = build(reportOf());
  const id = publishRecord(publishInput(record, history));
  expect(id).toBe(record.record_id);
  expect(existsSync(join(history, "records", "2026", `${id}.json`))).toBe(true);
  expect(existsSync(join(history, "raw", "2026", id, "report.json"))).toBe(true);
  expect(existsSync(join(history, "contracts", "CONTRACT-v2.md"))).toBe(true);
  expect(existsSync(join(history, "schema", "echo_throughput_v2.schema.json"))).toBe(true);
  expect(existsSync(join(history, ".nojekyll"))).toBe(true);
  const index = JSON.parse(readFileSync(join(history, "index.json"), "utf8")) as {
    records: { record_id: string }[];
  };
  expect(index.records).toHaveLength(1);
  expect(index.records[0].record_id).toBe(id);
  const readme = readFileSync(join(history, "README.md"), "utf8");
  expect(readme).toContain("Latest results");
  expect(readme).toContain("contracts/CONTRACT-v2.md");
  expect(readme).toContain("aaaaaaaaaaaa");
});

test("republishing identical content is idempotent and different content is refused", () => {
  const history = historyOf();
  const input = publishInput(build(reportOf()), history);
  publishRecord(input);
  expect(() => publishRecord(input)).not.toThrow();
  const changed = build({ ...reportOf(), gate: { failed: true } });
  expect(() => publishRecord({ ...input, record: changed })).toThrow(/immutable/);
});
