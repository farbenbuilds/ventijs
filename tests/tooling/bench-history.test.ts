// The publisher is the seam between a benchmark run and the durable
// benchmark-data branch: it refuses a report that drifted from the contract,
// writes an immutable record beside its raw evidence, and is idempotent for a
// re-run of the same record.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseContract, readContract } from "../../scripts/bench-contract.mjs";
import { publishRecord } from "../../scripts/bench-history.mjs";
import { buildRecord, type RecordWorkflow } from "../../scripts/bench-record.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const CONTRACT_SOURCE = read("bench/contracts/echo_throughput_v1.env");
const CONTRACT = readContract(parseContract(CONTRACT_SOURCE));
const SCHEMA_SOURCE = read("bench/contracts/echo_throughput_v1.schema.json");
const CONTRACT_DOC = read("bench/contracts/CONTRACT.md");
const RECORDED_AT = "2026-10-03T00:00:00.000Z";
const COMMIT = "a".repeat(40);

const WORKFLOW: RecordWorkflow = {
  repository: "farbenbuilds/ventiws",
  eventName: "schedule",
  gitRef: "refs/heads/main",
  commitSha: COMMIT,
  workflowRunUrl: "https://github.com/farbenbuilds/ventiws/actions/runs/123",
  runId: 123,
  runAttempt: 1,
  runnerOs: "Linux",
  runnerArch: "X64",
  runnerName: "GitHub Actions 1",
  runnerImage: "ubuntu24/20261001.1",
  kernel: "Linux 6.8.0",
};

const measuredLeg = (seconds: number) => ({
  samples: [seconds, seconds + 0.001, seconds + 0.002],
  medianSeconds: seconds + 0.001,
  medianRoundTripsPerSecond: Math.round(CONTRACT.messages / (seconds + 0.001)),
  medianWireBytesPerSecond: 1000,
  spread: 0.01,
  reason: null,
});

const reportOf = (messages = CONTRACT.messages) => ({
  provenance: {
    schemaVersion: "ventiws-ws-compare/3",
    nodeVersion: "24.21.0",
    nodeAbi: "137",
    pnpmVersion: "12.4.2",
    zigVersion: "0.16.0",
    lockfileSha256: "f".repeat(64),
    ventiwsVersion: "1.0.0-beta.5",
    wsVersion: "8.21.3",
    uwebSocketsVersion: "20.71.0",
    socketIoVersion: "4.8.4",
    socketIoClientVersion: "4.8.4",
    cpuModel: "Test CPU",
    cpuCount: 4,
    totalMemoryBytes: 16000000000,
  },
  parameters: {
    payloadSizes: [...CONTRACT.payloadSizes],
    messages,
    repeats: CONTRACT.repeats,
    warmupRepeatsDiscarded: CONTRACT.warmups,
    implementations: [...CONTRACT.implementations],
    gateBaseline: CONTRACT.gateBaseline,
    gateCandidate: CONTRACT.gateCandidate,
    gateMinimumRatio: CONTRACT.gateMinimumRatio,
    wireBytesBasis: CONTRACT.wireBytesBasis,
  },
  configurations: CONTRACT.payloadSizes.map((payloadBytes) => ({
    payloadBytes,
    legs: Object.fromEntries(CONTRACT.implementations.map((id) => [id, measuredLeg(0.02)])),
  })),
  gate: { failed: false },
});

const build = (report: unknown) =>
  buildRecord({
    report,
    contractSource: CONTRACT_SOURCE,
    recordedAt: RECORDED_AT,
    workflow: WORKFLOW,
  });

const publishInput = (record: ReturnType<typeof build>, historyDirectory: string) => ({
  record,
  reportSource: `${JSON.stringify(reportOf(), null, 2)}\n`,
  historyDirectory,
  contractSource: CONTRACT_SOURCE,
  contractName: "echo_throughput_v1.env",
  schemaSource: SCHEMA_SOURCE,
  schemaName: "echo_throughput_v1.schema.json",
  contractDocSource: CONTRACT_DOC,
});

test("a contract-conforming report becomes a record with its provenance", () => {
  const record = build(reportOf());
  expect(record.record_id).toBe(`123-1-${"a".repeat(12)}`);
  expect(record.guarantee.passed).toBe(true);
  expect(record.methodology.implementations).toEqual([...CONTRACT.implementations]);
  expect(record.results.configurations).toHaveLength(CONTRACT.payloadSizes.length);
  expect(record.results.configurations[0].candidate_to_baseline_ratio).toBeCloseTo(1, 5);
});

test("a report whose parameters drifted from the contract is refused", () => {
  expect(() => build(reportOf(CONTRACT.messages + 1))).toThrow(
    /messages does not match the contract/,
  );
});

test("publishing writes the record, its raw report, and the branch scaffolding", () => {
  const history = mkdtempSync(join(tmpdir(), "ventiws-bench-history-"));
  const record = build(reportOf());
  const id = publishRecord(publishInput(record, history));
  expect(id).toBe(record.record_id);
  expect(existsSync(join(history, "records", "2026", `${id}.json`))).toBe(true);
  expect(existsSync(join(history, "raw", "2026", id, "report.json"))).toBe(true);
  expect(existsSync(join(history, "CONTRACT.md"))).toBe(true);
  expect(existsSync(join(history, "schema", "echo_throughput_v1.schema.json"))).toBe(true);
  expect(existsSync(join(history, ".nojekyll"))).toBe(true);
  const index = JSON.parse(readFileSync(join(history, "index.json"), "utf8")) as {
    records: { record_id: string }[];
  };
  expect(index.records).toHaveLength(1);
  expect(index.records[0].record_id).toBe(id);
  const readme = readFileSync(join(history, "README.md"), "utf8");
  expect(readme).toContain("Latest results");
  expect(readme).toContain("aaaaaaaaaaaa");
});

test("republishing identical content is idempotent and different content is refused", () => {
  const history = mkdtempSync(join(tmpdir(), "ventiws-bench-history-"));
  const input = publishInput(build(reportOf()), history);
  publishRecord(input);
  expect(() => publishRecord(input)).not.toThrow();
  const changed = build({ ...reportOf(), gate: { failed: true } });
  expect(() => publishRecord({ ...input, record: changed })).toThrow(/immutable/);
});
