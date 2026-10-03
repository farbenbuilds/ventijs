// Writes one immutable record into a benchmark-data checkout: the canonical
// record, the raw report, the contract copies, the rolling index and latest
// pointers, and the generated README. Identical content is idempotent; changed
// content under an existing record ID is a rewritten history and is refused.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderReadme } from "./bench-readme.mjs";

export const RECORD_ID_PATTERN = /^[0-9]+-[0-9]+-[0-9a-f]{12}$/;
const RAW_REPORT = "report.json";
const NO_JEKYLL = ".nojekyll";

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};

const readJson = (path) => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
};

const writeImmutable = (path, content) => {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error(`published benchmark artifact is immutable: ${path}`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const summarize = (record, recordPath, rawPath) => {
  const measured = record.results.configurations.filter(
    (configuration) => configuration.candidate_to_baseline_ratio !== null,
  );
  const worst = measured.reduce(
    (lowest, configuration) =>
      lowest === null ||
      configuration.candidate_to_baseline_ratio < lowest.candidate_to_baseline_ratio
        ? configuration
        : lowest,
    null,
  );
  return {
    record_id: record.record_id,
    recorded_at: record.recorded_at,
    commit_sha: record.provenance.commit_sha,
    passed: record.guarantee.passed,
    median_ratio:
      measured.length === 0
        ? null
        : median(measured.map((configuration) => configuration.candidate_to_baseline_ratio)),
    worst_payload_bytes: worst?.payload_bytes ?? null,
    worst_ratio: worst?.candidate_to_baseline_ratio ?? null,
    record_path: recordPath,
    raw_path: rawPath,
  };
};

export const publishRecord = (input) => {
  const { record, historyDirectory } = input;
  if (!RECORD_ID_PATTERN.test(record.record_id)) {
    throw new Error(`invalid benchmark record ID "${record.record_id}"`);
  }
  const year = record.recorded_at.slice(0, 4);
  if (!/^[0-9]{4}$/.test(year)) throw new Error("invalid benchmark timestamp");
  const recordPath = `records/${year}/${record.record_id}.json`;
  const rawPath = `raw/${year}/${record.record_id}/${RAW_REPORT}`;
  const contractDocPath = `contracts/${input.contractDocName}`;
  writeImmutable(join(historyDirectory, recordPath), `${JSON.stringify(record, null, 2)}\n`);
  writeImmutable(join(historyDirectory, rawPath), input.reportSource);
  writeImmutable(join(historyDirectory, "schema", input.schemaName), input.schemaSource);
  writeImmutable(join(historyDirectory, "contracts", input.contractName), input.contractSource);
  writeImmutable(join(historyDirectory, contractDocPath), input.contractDocSource);
  writeFileSync(join(historyDirectory, NO_JEKYLL), "");

  const indexPath = join(historyDirectory, "index.json");
  const stored = readJson(indexPath);
  // A new benchmark ID starts a new series; the previous index is archived so its
  // records stay reachable from the branch.
  if (stored !== null && stored.benchmark_id !== record.benchmark_id) {
    writeJson(join(historyDirectory, `index-${stored.benchmark_id}.json`), stored);
  }
  const index =
    stored !== null && stored.benchmark_id === record.benchmark_id
      ? stored
      : { schema_version: 1, benchmark_id: record.benchmark_id, records: [] };
  const entry = summarize(record, recordPath, rawPath);
  index.records = [
    entry,
    ...index.records.filter((existing) => existing.record_id !== entry.record_id),
  ];
  index.records.sort((left, right) =>
    left.recorded_at === right.recorded_at
      ? right.record_id.localeCompare(left.record_id)
      : right.recorded_at.localeCompare(left.recorded_at),
  );
  writeJson(indexPath, index);
  writeJson(join(historyDirectory, "latest.json"), record);
  writeFileSync(join(historyDirectory, "README.md"), renderReadme(index, record, contractDocPath));
  return record.record_id;
};
