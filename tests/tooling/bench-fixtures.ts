// Shared fixtures for the publisher suites: a contract-conforming report, the fixed
// workflow provenance, and the input the history writer takes. Kept out of the test files
// so each suite stays inside the module budget and reads as assertions, not setup.

import { readFileSync } from "node:fs";
import { parseContract, readContract } from "../../scripts/bench-contract.mjs";
import {
  buildRecord,
  type BenchmarkRecord,
  type RecordWorkflow,
} from "../../scripts/bench-record.mjs";

const ROOT = new URL("../../", import.meta.url);

export type ReportFixture = {
  readonly provenance: Record<string, unknown>;
  readonly parameters: Record<string, unknown>;
  readonly configurations: Record<string, unknown>[];
  readonly gate: { readonly failed: boolean };
};

export type PublishInput = {
  readonly record: BenchmarkRecord;
  readonly reportSource: string;
  readonly historyDirectory: string;
  readonly contractSource: string;
  readonly contractName: string;
  readonly schemaSource: string;
  readonly schemaName: string;
  readonly contractDocSource: string;
  readonly contractDocName: string;
};

export const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

export const CONTRACT_SOURCE = read("bench/contracts/echo_throughput_v2.env");
export const CONTRACT = readContract(parseContract(CONTRACT_SOURCE));
export const SCHEMA_SOURCE = read("bench/contracts/echo_throughput_v2.schema.json");
export const CONTRACT_DOC = read("bench/contracts/CONTRACT-v2.md");
export const RECORDED_AT = "2026-10-03T00:00:00.000Z";
export const COMMIT = "a".repeat(40);

export const WORKFLOW: RecordWorkflow = {
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

export const reportOf = (messages = CONTRACT.messages): ReportFixture => ({
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

export const build = (report: unknown): BenchmarkRecord =>
  buildRecord({
    report,
    contractSource: CONTRACT_SOURCE,
    recordedAt: RECORDED_AT,
    workflow: WORKFLOW,
  });

export const publishInput = (record: BenchmarkRecord, historyDirectory: string): PublishInput => ({
  record,
  reportSource: `${JSON.stringify(reportOf(), null, 2)}\n`,
  historyDirectory,
  contractSource: CONTRACT_SOURCE,
  contractName: "echo_throughput_v2.env",
  schemaSource: SCHEMA_SOURCE,
  schemaName: "echo_throughput_v2.schema.json",
  contractDocSource: CONTRACT_DOC,
  contractDocName: "CONTRACT-v2.md",
});
