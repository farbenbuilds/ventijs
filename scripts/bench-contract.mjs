// The frozen definition of `echo-throughput-v2`: the contract env file is
// parsed, the report is held to it, and the durable record is built from both.
// Keeping the three in one place stops a published record from describing a run
// the contract does not define.

import { createHash } from "node:crypto";

export const BENCHMARK_ID = "echo-throughput-v2";
export const RECORD_SCHEMA_VERSION = 1;
export const REPORT_SCHEMA_VERSION = "ventiws-ws-compare/3";

export const parseContract = (source) => {
  const entries = new Map();
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) throw new Error(`contract line is not KEY=value: "${trimmed}"`);
    entries.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return entries;
};

export const contractDigest = (source) => createHash("sha256").update(source).digest("hex");

const readText = (entries, key) => {
  const value = entries.get(key);
  if (value === undefined || value === "") throw new Error(`contract ${key} is missing`);
  return value;
};

const readInteger = (entries, key) => {
  const value = Number(readText(entries, key));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`contract ${key} is not a non-negative integer`);
  }
  return value;
};

const readRatio = (entries, key) => {
  const value = Number(readText(entries, key));
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`contract ${key} is not a ratio in (0, 1]`);
  }
  return value;
};

const readList = (entries, key) =>
  readText(entries, key)
    .split(",")
    .map((field) => field.trim());

const readSizes = (entries, key) => {
  const sizes = readList(entries, key).map(Number);
  if (sizes.length === 0 || sizes.some((size) => !Number.isInteger(size) || size <= 0)) {
    throw new Error(`contract ${key} is not a list of positive byte sizes`);
  }
  return sizes;
};

export const readContract = (entries) => ({
  implementations: readList(entries, "IMPLEMENTATIONS"),
  gateBaseline: readText(entries, "GATE_BASELINE"),
  gateCandidate: readText(entries, "GATE_CANDIDATE"),
  gateMinimumRatio: readRatio(entries, "GATE_MINIMUM_RATIO"),
  payloadSizes: readSizes(entries, "PAYLOAD_SIZES_BYTES"),
  messages: readInteger(entries, "MESSAGES"),
  repeats: readInteger(entries, "REPEATS"),
  warmups: readInteger(entries, "WARMUPS"),
  wireBytesBasis: readText(entries, "WIRE_BYTES_BASIS"),
});

/// A report whose parameters drifted from the contract is not the benchmark the
/// history claims to record, so publication stops instead of storing a record
/// whose methodology columns disagree with its own contract hash.
export const assertReportMatchesContract = (report, contract) => {
  if (report?.provenance?.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(`report is not ${REPORT_SCHEMA_VERSION}`);
  }
  const actual = {
    implementations: report.parameters?.implementations,
    gateBaseline: report.parameters?.gateBaseline,
    gateCandidate: report.parameters?.gateCandidate,
    gateMinimumRatio: report.parameters?.gateMinimumRatio,
    payloadSizes: report.parameters?.payloadSizes,
    messages: report.parameters?.messages,
    repeats: report.parameters?.repeats,
    warmups: report.parameters?.warmupRepeatsDiscarded,
    wireBytesBasis: report.parameters?.wireBytesBasis,
  };
  for (const key of Object.keys(contract)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(contract[key])) {
      throw new Error(`report ${key} does not match the contract`);
    }
  }
};
